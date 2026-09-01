"use strict";
/**
 * VS Code Copilot Proxy Extension
 *
 * Exposes an OpenAI-compatible HTTP API that proxies requests through
 * VS Code's Language Model API (GitHub Copilot).
 *
 * @see docs/features/copilot-proxy/design.md - Core proxy architecture
 * @see docs/features/webview-status-panel/design.md - Status panel UI
 * @see docs/features/security-hardening/design.md - Security features
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const core_1 = require("./core");
const security_1 = require("./security");
let server = null;
const activeSockets = new Set();
let statusBarItem;
let outputChannel;
let statusPanel;
// Secret storage key for the proxy bearer token (see setProxyToken command / authenticateRequest).
const PROXY_TOKEN_SECRET_KEY = 'copilotProxy.proxyToken';
/**
 * Authenticates an incoming HTTP request against the stored proxy token.
 * Denies by default when no token has been configured (safer than open access).
 * Never logs the Authorization header, parsed token, or stored token.
 */
async function authenticateRequest(req) {
    const storedToken = await extensionContext?.secrets.get(PROXY_TOKEN_SECRET_KEY);
    if (!storedToken)
        return false;
    const parsedToken = (0, security_1.parseBearerToken)(req.headers.authorization);
    if (!parsedToken)
        return false;
    return (0, security_1.constantTimeEqual)(parsedToken, storedToken);
}
/**
 * Computes CORS headers for a given request using the configured origin allowlist.
 * Thin wrapper around security.ts's buildCorsHeaders so call sites don't each
 * need to read configuration.
 */
function getRequestCorsHeaders(req) {
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const allowedOrigins = config.get('allowedOrigins', []);
    return (0, security_1.buildCorsHeaders)(req.headers.origin, allowedOrigins);
}
// Visual symbols for log messages
const LOG_SYMBOLS = {
    startup: '🚀',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    request: '📨',
    response: '📤',
    tool: '🔧',
    model: '🤖',
    stream: '🔄',
    info: '💡',
    server: '🌐',
    connect: '🔌',
    disconnect: '🔗',
};
// Request logs storage (max 50 entries)
const MAX_REQUEST_LOGS = 50;
let requestLogs = [];
// Stats counters: session resets on activate; lifetime persists in globalState.
const LIFETIME_STATS_KEY = 'copilotProxy.lifetimeStats';
let extensionContext;
const sessionStats = (0, core_1.emptyStats)();
let lifetimeStats = (0, core_1.emptyStats)();
function persistLifetimeStats() {
    extensionContext?.globalState.update(LIFETIME_STATS_KEY, lifetimeStats);
}
function addRequestLog(entry) {
    // Always collect logs
    requestLogs.unshift(entry);
    if (requestLogs.length > MAX_REQUEST_LOGS) {
        requestLogs = requestLogs.slice(0, MAX_REQUEST_LOGS);
    }
    (0, core_1.applyStatsEntry)(sessionStats, entry);
    (0, core_1.applyStatsEntry)(lifetimeStats, entry);
    persistLifetimeStats();
    // Always update panel if open (UI decides whether to display logs based on setting)
    if (statusPanel) {
        updateStatusPanel();
    }
}
function log(message, symbol) {
    const prefix = symbol ? `${LOG_SYMBOLS[symbol]} ` : '';
    console.log(`[Copilot Proxy] ${message}`);
    outputChannel?.info(`${prefix}${message}`);
}
function logWarn(message, symbol) {
    const prefix = symbol ? `${LOG_SYMBOLS[symbol]} ` : `${LOG_SYMBOLS.warning} `;
    console.warn(`[Copilot Proxy] ${message}`);
    outputChannel?.warn(`${prefix}${message}`);
}
function logError(message, error) {
    const errorDetails = error instanceof Error ? error.message : String(error ?? '');
    const fullMessage = errorDetails ? `${message} - ${errorDetails}` : message;
    console.error(`[Copilot Proxy] ERROR: ${message}`, error);
    outputChannel?.error(`${LOG_SYMBOLS.error} ${fullMessage}`);
}
/**
 * Sends a standardized HTTP error response.
 * Uses createErrorResponse from core.ts for consistent formatting.
 */
function sendErrorResponse(res, statusCode, message, type) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify((0, core_1.createErrorResponse)(message, type, statusCode)));
}
// Cache for available models
let cachedModels = [];
let modelsLastRefreshed = 0;
let isRefreshing = false;
async function refreshModels() {
    // Prevent concurrent refreshes
    if (isRefreshing) {
        log('Model refresh already in progress, skipping');
        return cachedModels;
    }
    isRefreshing = true;
    log('Starting model refresh...');
    try {
        // Add timeout to prevent hanging if Copilot isnt ready
        const timeoutMs = 5000;
        const modelsPromise = vscode.lm.selectChatModels({});
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Model refresh timed out')), timeoutMs));
        cachedModels = await Promise.race([modelsPromise, timeoutPromise]);
        modelsLastRefreshed = Date.now();
        log(`Found ${cachedModels.length} models`);
        return cachedModels;
    }
    catch (error) {
        logError('Failed to refresh models', error);
        return cachedModels; // Return existing cache on error
    }
    finally {
        isRefreshing = false;
    }
}
/**
 * Error thrown when Copilot's session/handles are stale and a retry could not
 * recover. Surfaced to clients as 503 with a hint to open Copilot Chat once.
 */
class CopilotNotReadyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CopilotNotReadyError';
    }
}
/**
 * Heuristic: does this error look like a stale Copilot session (vs a real
 * validation/content error)? Triggers the one-shot refresh-and-retry.
 */
function isLikelyStaleSessionError(error) {
    if (error instanceof vscode.LanguageModelError) {
        // Most LanguageModelError causes (NoPermissions, Blocked, Unknown) can
        // be transient after Copilot's session token rotates. The retry cost is
        // one extra call; if it's a permanent failure the retry fails the same.
        return true;
    }
    const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
    return /auth|session|token|unauthor|401|403|expired|permission|not\s*ready|copilot/.test(msg);
}
/**
 * Detects the Copilot worker out-of-memory crash. The vscode.lm request runs in
 * a Node worker thread; an oversized payload exhausts its heap and the thread is
 * terminated ("Worker terminated due to reaching memory limit: JS heap out of
 * memory"). This kills the language model subsystem for the rest of the session,
 * so the only recovery is reducing request size and reloading VS Code.
 */
function isCopilotWorkerOOM(error) {
    const msg = error instanceof Error ? error.message : String(error ?? '');
    return /worker terminated|memory limit|heap out of memory|out of memory/i.test(msg);
}
// Guard so the OOM reload prompt is shown at most once per window session (the
// flag resets when the extension reactivates after a reload).
let oomReloadPromptShown = false;
/**
 * Shows a one-time notification offering to reload the window after a Copilot
 * worker OOM, since the language model subsystem stays dead until reload.
 */
function notifyCopilotWorkerOOM() {
    if (oomReloadPromptShown)
        return;
    oomReloadPromptShown = true;
    void vscode.window.showErrorMessage('Copilot Proxy: the language model worker ran out of memory and is now unavailable. Reduce request size; reload the window to recover.', 'Reload Window').then(choice => {
        if (choice === 'Reload Window') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    });
}
/**
 * Maps an error to a client-facing message. For the Copilot worker OOM, rewrites
 * the opaque worker error into actionable guidance and prompts a window reload;
 * otherwise returns the raw message unchanged.
 */
function describeRequestError(error) {
    const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    if (isCopilotWorkerOOM(error)) {
        notifyCopilotWorkerOOM();
        return `Request too large: Copilot's model worker ran out of memory (${raw}). Reduce the request size - trim conversation history, context, or tool definitions. The VS Code language model may need a window reload to recover.`;
    }
    return raw;
}
/**
 * Calls model.sendRequest with one retry on stale-session errors. On retry,
 * forces refreshModels() and re-resolves the model handle against the current
 * Copilot session.
 *
 * Returns the (possibly newly-resolved) model alongside the response so callers
 * can use the live handle for logging/stream iteration.
 */
async function sendRequestWithRetry(initialModel, requestedModelName, messages, options, token) {
    try {
        const response = await initialModel.sendRequest(messages, options, token);
        return { response, model: initialModel };
    }
    catch (error) {
        // Don't retry if the client/timeout already cancelled - the second
        // attempt would fail immediately on the same already-cancelled token.
        if (token.isCancellationRequested) {
            throw error;
        }
        if (!isLikelyStaleSessionError(error)) {
            throw error;
        }
        logWarn(`sendRequest failed (likely stale Copilot session): ${error instanceof Error ? error.message : String(error)}. Refreshing models and retrying once.`);
        // Force a refresh by clearing the timestamp so getModel re-fetches.
        modelsLastRefreshed = 0;
        const freshModel = await getModel(requestedModelName);
        if (!freshModel) {
            throw new CopilotNotReadyError('Copilot Chat is not ready. Open Copilot Chat once (type a message and stop) then retry.');
        }
        try {
            const response = await freshModel.sendRequest(messages, options, token);
            log(`sendRequest retry succeeded with refreshed model: ${freshModel.id}`, 'success');
            return { response, model: freshModel };
        }
        catch (retryError) {
            const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
            throw new CopilotNotReadyError(`Copilot session expired or unavailable. Open Copilot Chat once (type a message and stop) then retry. (${retryMsg})`);
        }
    }
}
async function getModel(requestedModel) {
    // Refresh if cache is empty or older than TTL. Stale handles tied to an
    // expired Copilot session will hang on sendRequest, so re-resolving against
    // the current session list before each request keeps idle proxies usable.
    const cacheAge = Date.now() - modelsLastRefreshed;
    if (cachedModels.length === 0 || cacheAge > core_1.MODEL_CACHE_TTL_MS) {
        await refreshModels();
    }
    // Get default model from VS Code config if no model specified
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const defaultModel = config.get('defaultModel', '');
    // Use findBestModel from core.ts for matching logic
    return (0, core_1.findBestModel)(requestedModel, cachedModels, defaultModel);
}
// ============================================================================
// Tool/Function Calling Support
// @see docs/features/tool-calling/design.md
// ============================================================================
/**
 * Gets available tools from VS Code's lm.tools API.
 */
async function getAvailableTools() {
    try {
        // vscode.lm.tools is an array of LanguageModelToolInformation
        const vsCodeTools = vscode.lm.tools || [];
        return vsCodeTools.map(tool => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema,
            tags: tool.tags
        }));
    }
    catch (error) {
        logError('Failed to get available tools', error);
        return [];
    }
}
/**
 * Converts OpenAI tool format to VS Code LanguageModelChatTool format.
 */
function convertToVSCodeTools(tools) {
    return tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description || '',
        inputSchema: tool.function.parameters
    }));
}
/**
 * Merges request tools with VS Code tools if use_vscode_tools is enabled.
 */
async function mergeWithVSCodeTools(requestTools, useVSCodeTools) {
    const tools = requestTools ? [...requestTools] : [];
    if (useVSCodeTools) {
        const vsCodeTools = await getAvailableTools();
        const existingNames = new Set(tools.map(t => t.function.name));
        for (const vsTool of vsCodeTools) {
            if (!existingNames.has(vsTool.name)) {
                tools.push({
                    type: 'function',
                    function: {
                        name: vsTool.name,
                        description: vsTool.description,
                        parameters: vsTool.inputSchema
                    }
                });
            }
        }
    }
    return tools;
}
/**
 * Converts a VS Code LanguageModelToolCallPart to OpenAI ToolCall format.
 */
function convertToolCallPart(part) {
    return {
        id: part.callId || (0, core_1.generateToolCallId)(),
        type: 'function',
        function: {
            name: part.name,
            arguments: JSON.stringify(part.input)
        }
    };
}
/**
 * Executes a single tool call via VS Code's lm.invokeTool API.
 * Returns the tool result content.
 */
async function executeToolCall(toolCall, cancellationToken) {
    try {
        let input = {};
        try {
            input = JSON.parse(toolCall.function.arguments);
        }
        catch {
            logWarn(`Could not parse tool arguments for ${toolCall.function.name}`);
        }
        log(`Executing tool: ${toolCall.function.name}`, 'tool');
        // Use VS Code's lm.invokeTool API
        const result = await vscode.lm.invokeTool(toolCall.function.name, {
            input,
            toolInvocationToken: undefined // No special token needed
        }, cancellationToken);
        // Convert result to string
        let content = '';
        if (result) {
            // Result is LanguageModelToolResult - convert based on structure
            if (Array.isArray(result)) {
                for (const part of result) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        content += part.value;
                    }
                    else if (typeof part === 'string') {
                        content += part;
                    }
                }
            }
            else if (typeof result === 'object' && 'content' in result) {
                // Handle object with content property
                const resultContent = result.content;
                if (Array.isArray(resultContent)) {
                    for (const part of resultContent) {
                        if (part instanceof vscode.LanguageModelTextPart) {
                            content += part.value;
                        }
                        else if (typeof part === 'string') {
                            content += part;
                        }
                    }
                }
                else if (typeof resultContent === 'string') {
                    content = resultContent;
                }
            }
            else if (typeof result === 'string') {
                content = result;
            }
            else {
                // Fallback: stringify the result
                content = JSON.stringify(result);
            }
        }
        log(`Tool ${toolCall.function.name} completed: ${content.length} chars`, 'tool');
        return { success: true, content };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`Tool ${toolCall.function.name} failed`, error);
        return { success: false, content: `Error: ${errorMessage}` };
    }
}
/**
 * Runs the auto-execute loop: sends request, executes tool calls, repeats until done.
 * Returns the final response content.
 */
async function runAutoExecuteLoop(model, requestedModelName, initialMessages, options, maxRounds, cancellationToken) {
    const messages = [...initialMessages];
    let totalToolCalls = 0;
    let round = 0;
    const unlimited = maxRounds === 0;
    // Mutable so the retry helper can swap in a refreshed model handle
    // for subsequent rounds if Copilot's session rotated mid-loop.
    let currentModel = model;
    while (unlimited || round < maxRounds) {
        round++;
        log(`Auto-execute round ${round}${unlimited ? '' : `/${maxRounds}`}`);
        const sendResult = await sendRequestWithRetry(currentModel, requestedModelName, messages, options, cancellationToken);
        const response = sendResult.response;
        currentModel = sendResult.model;
        let content = '';
        const toolCalls = [];
        // Process response
        const stream = response.stream || (async function* () {
            for await (const text of response.text) {
                yield new vscode.LanguageModelTextPart(text);
            }
        })();
        for await (const part of stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                content += part.value;
            }
            else if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push(convertToolCallPart(part));
            }
        }
        // If no tool calls, we're done
        if (toolCalls.length === 0) {
            log(`Auto-execute completed after ${round} round(s), ${totalToolCalls} tool call(s)`);
            return { content, toolCallsExecuted: totalToolCalls };
        }
        // Execute all tool calls
        log(`Executing ${toolCalls.length} tool call(s) in round ${round}`);
        totalToolCalls += toolCalls.length;
        // Add assistant message with tool calls
        const assistantParts = [];
        if (content) {
            assistantParts.push(new vscode.LanguageModelTextPart(content));
        }
        for (const tc of toolCalls) {
            let input = {};
            try {
                input = JSON.parse(tc.function.arguments);
            }
            catch {
                // ignore
            }
            assistantParts.push(new vscode.LanguageModelToolCallPart(tc.id, tc.function.name, input));
        }
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
        // Execute tools and add results
        for (const toolCall of toolCalls) {
            const result = await executeToolCall(toolCall, cancellationToken);
            messages.push(vscode.LanguageModelChatMessage.User([
                new vscode.LanguageModelToolResultPart(toolCall.id, [new vscode.LanguageModelTextPart(result.content)])
            ]));
        }
    }
    log(`Auto-execute reached max rounds (${maxRounds}), returning partial result`);
    return { content: '[Max tool execution rounds reached]', toolCallsExecuted: totalToolCalls };
}
/**
 * Handles GET /v1/tools endpoint.
 */
async function handleTools(req, res, corsHeaders) {
    try {
        // Parse query parameters
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const tagsParam = url.searchParams.get('tags');
        const nameParam = url.searchParams.get('name');
        let tools = await getAvailableTools();
        // Apply filters
        if (tagsParam) {
            const tags = tagsParam.split(',').map(t => t.trim()).filter(t => t);
            tools = (0, core_1.filterToolsByTags)(tools, tags);
        }
        if (nameParam) {
            tools = (0, core_1.filterToolsByName)(tools, nameParam);
        }
        log(`GET /v1/tools: ${tools.length} tools available`);
        const response = {
            object: 'list',
            data: tools
        };
        res.writeHead(200, {
            'Content-Type': 'application/json',
            ...corsHeaders
        });
        res.end(JSON.stringify(response));
    }
    catch (error) {
        logError('Failed to handle tools request', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        sendErrorResponse(res, 500, errorMessage, 'server_error');
    }
}
function convertToVSCodeMessages(messages) {
    // Check for system messages and log warning
    const systemMessageCount = messages.filter(m => m.role === 'system').length;
    if (systemMessageCount > 0) {
        logWarn(`${systemMessageCount} system message(s) converted to user role (VS Code LM API limitation)`);
    }
    return messages.map(msg => {
        const text = (0, core_1.getTextContent)(msg.content);
        switch (msg.role) {
            case 'system':
                // VS Code LM API doesn't have a system role - convert to user message
                return vscode.LanguageModelChatMessage.User(text);
            case 'assistant':
                // Handle assistant messages with tool calls
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    // Create message parts: text content (if any) + tool call parts
                    const parts = [];
                    if (text) {
                        parts.push(new vscode.LanguageModelTextPart(text));
                    }
                    for (const toolCall of msg.tool_calls) {
                        let input = {};
                        try {
                            input = JSON.parse(toolCall.function.arguments);
                        }
                        catch {
                            logWarn(`Could not parse tool call arguments for ${toolCall.function.name}`);
                        }
                        parts.push(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, input));
                    }
                    return vscode.LanguageModelChatMessage.Assistant(parts);
                }
                return vscode.LanguageModelChatMessage.Assistant(text);
            case 'tool':
                // Tool result messages - VS Code expects these as user messages with ToolResultPart
                if (msg.tool_call_id) {
                    return vscode.LanguageModelChatMessage.User([
                        new vscode.LanguageModelToolResultPart(msg.tool_call_id, [new vscode.LanguageModelTextPart(text)])
                    ]);
                }
                // Fallback if no tool_call_id (shouldn't happen if validation works)
                return vscode.LanguageModelChatMessage.User(text);
            case 'user':
            default:
                return vscode.LanguageModelChatMessage.User(text);
        }
    });
}
async function handleChatCompletion(req, res) {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    const startTime = Date.now();
    // Set request timeout
    req.setTimeout(core_1.REQUEST_TIMEOUT_MS, () => {
        if (!aborted) {
            aborted = true;
            logError(`Request timed out after ${core_1.REQUEST_TIMEOUT_MS}ms`);
            sendErrorResponse(res, 408, 'Request timeout', 'timeout_error');
            req.destroy();
        }
    });
    req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > core_1.MAX_REQUEST_BODY_SIZE) {
            aborted = true;
            logError(`Request body too large: ${bodySize} bytes (max: ${core_1.MAX_REQUEST_BODY_SIZE})`);
            sendErrorResponse(res, 413, 'Request body too large', 'invalid_request_error');
            req.destroy();
            return;
        }
        body += chunk.toString();
    });
    req.on('end', async () => {
        if (aborted)
            return;
        try {
            // Parse and validate request
            const parsed = (0, core_1.parseRequestBody)(body);
            if (!parsed) {
                logError('Invalid JSON in request body');
                sendErrorResponse(res, 400, 'Invalid JSON in request body', 'invalid_request_error');
                return;
            }
            const validationError = (0, core_1.validateRequest)(parsed);
            if (validationError) {
                logError(`Request validation failed: ${validationError}`);
                sendErrorResponse(res, 400, validationError, 'invalid_request_error');
                return;
            }
            const request = parsed;
            const requestId = (0, core_1.generateId)();
            const model = await getModel(request.model);
            // Calculate context size
            const messageCount = request.messages.length;
            const totalChars = request.messages.reduce((sum, m) => sum + (0, core_1.getTextContent)(m.content).length, 0);
            const estimatedTokens = Math.ceil(totalChars / 4); // rough estimate: ~4 chars per token
            const requestedModel = request.model || '(default)';
            if (!model) {
                logError(`No language models available (requested: ${requestedModel})`);
                sendErrorResponse(res, 503, 'No language models available. Make sure GitHub Copilot is installed and authenticated, then open Copilot Chat once (type a message and stop) and retry.', 'service_unavailable');
                return;
            }
            // Prepare tools (merge with VS Code tools if use_vscode_tools is enabled)
            const allTools = await mergeWithVSCodeTools(request.tools, request.use_vscode_tools ?? false);
            const hasTools = allTools.length > 0;
            log(`Request: ${messageCount} msgs, ~${estimatedTokens} tokens, stream: ${request.stream ?? false}${hasTools ? `, ${allTools.length} tools` : ''}`, 'request');
            log(`Model: ${requestedModel} → ${model.name} (${model.id})`, 'model');
            const vsCodeMessages = convertToVSCodeMessages(request.messages);
            // Create cancellation token with timeout
            // Non-streaming/auto-execute: absolute 5-min deadline
            // Streaming: replaced below with activity-based inactivity timeout
            const cancellationSource = new vscode.CancellationTokenSource();
            let timeoutId = setTimeout(() => cancellationSource.cancel(), core_1.REQUEST_TIMEOUT_MS);
            // Build request options with tools if provided
            const options = {};
            if (hasTools) {
                options.tools = convertToVSCodeTools(allTools);
                // Map tool_choice to VS Code toolMode
                if (request.tool_choice === 'required') {
                    options.toolMode = vscode.LanguageModelChatToolMode.Required;
                }
                // 'none' - don't pass tools at all (handled above by not setting options.tools)
                // 'auto' - default behavior
                // specific function - filter to single tool (not supported by VS Code API directly)
            }
            // Handle auto-execute mode (server-side tool execution)
            const autoToolConfig = vscode.workspace.getConfiguration('copilotProxy');
            const allowAutoToolExecution = autoToolConfig.get('allowAutoToolExecution', false);
            if ((0, security_1.isAutoExecutionAllowed)(request.tool_execution, allowAutoToolExecution) && hasTools) {
                log('Auto-execute mode enabled', 'tool');
                const maxRounds = (0, security_1.validateMaxToolRounds)(request.max_tool_rounds);
                if (maxRounds === null) {
                    sendErrorResponse(res, 400, 'max_tool_rounds must be an integer between 1 and 100', 'invalid_request_error');
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                    return;
                }
                try {
                    const result = await runAutoExecuteLoop(model, request.model, vsCodeMessages, options, maxRounds, cancellationSource.token);
                    const responseTokens = Math.ceil(result.content.length / 4);
                    log(`Auto-execute response: ~${result.content.length} chars (~${responseTokens} tokens), ${result.toolCallsExecuted} tool call(s) executed`);
                    // Return final response (no tool_calls - they were executed)
                    const openAIResponse = {
                        id: (0, core_1.generateId)(),
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: model.id,
                        choices: [{
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: result.content
                                },
                                finish_reason: 'stop'
                            }],
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Connection': 'close',
                        ...getRequestCorsHeaders(req)
                    });
                    res.end(JSON.stringify(openAIResponse));
                    // Log to UI
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/chat/completions',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: result.content.length,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'success'
                    });
                }
                catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Auto-execute failed after ${durationMs}ms`, error);
                    const errorMessage = describeRequestError(error);
                    sendErrorResponse(res, 500, errorMessage, 'server_error');
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/chat/completions',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: 0,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'error',
                        errorMessage: (0, security_1.categorizeError)(error)
                    });
                }
                finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
                return;
            }
            if (request.stream) {
                // Streaming response
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...getRequestCorsHeaders(req)
                });
                // Replace absolute deadline with activity-based inactivity timeout
                clearTimeout(timeoutId);
                const resetStreamTimeout = () => {
                    clearTimeout(timeoutId);
                    timeoutId = setTimeout(() => cancellationSource.cancel(), core_1.STREAM_INACTIVITY_TIMEOUT_MS);
                };
                resetStreamTimeout();
                // Cancel model request when client disconnects
                res.on('close', () => cancellationSource.cancel());
                // Disable socket-level timeout and its destroy callback for long-running streams
                req.setTimeout(0);
                req.socket?.setTimeout(0);
                const id = (0, core_1.generateId)();
                const created = Math.floor(Date.now() / 1000);
                try {
                    const { response } = await sendRequestWithRetry(model, request.model, vsCodeMessages, options, cancellationSource.token);
                    // Send initial chunk with role
                    const initialChunk = {
                        id,
                        object: 'chat.completion.chunk',
                        created,
                        model: model.id,
                        choices: [{
                                index: 0,
                                delta: { role: 'assistant' },
                                finish_reason: null
                            }]
                    };
                    res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);
                    // Stream content and tool call chunks
                    let responseChars = 0;
                    const toolCalls = [];
                    const toolCallArgumentsBuffer = new Map();
                    let toolCallIndex = 0;
                    // Use response.stream if available (for tool calling), otherwise fall back to response.text
                    const stream = response.stream || (async function* () {
                        for await (const text of response.text) {
                            yield new vscode.LanguageModelTextPart(text);
                        }
                    })();
                    for await (const part of stream) {
                        resetStreamTimeout();
                        if (part instanceof vscode.LanguageModelTextPart) {
                            // Regular text content
                            const text = part.value;
                            responseChars += text.length;
                            const streamChunk = {
                                id,
                                object: 'chat.completion.chunk',
                                created,
                                model: model.id,
                                choices: [{
                                        index: 0,
                                        delta: { content: text },
                                        finish_reason: null
                                    }]
                            };
                            res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
                        }
                        else if (part instanceof vscode.LanguageModelToolCallPart) {
                            // Tool call from model
                            const toolCall = convertToolCallPart(part);
                            toolCalls.push(toolCall);
                            // Send tool call delta chunks
                            // First chunk: id, type, function.name
                            const firstDelta = {
                                index: toolCallIndex,
                                id: toolCall.id,
                                type: 'function',
                                function: {
                                    name: toolCall.function.name,
                                    arguments: ''
                                }
                            };
                            const firstChunk = {
                                id,
                                object: 'chat.completion.chunk',
                                created,
                                model: model.id,
                                choices: [{
                                        index: 0,
                                        delta: { tool_calls: [firstDelta] },
                                        finish_reason: null
                                    }]
                            };
                            res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);
                            // Second chunk: arguments (could be streamed incrementally, but VS Code gives us all at once)
                            const argsDelta = {
                                index: toolCallIndex,
                                function: {
                                    arguments: toolCall.function.arguments
                                }
                            };
                            const argsChunk = {
                                id,
                                object: 'chat.completion.chunk',
                                created,
                                model: model.id,
                                choices: [{
                                        index: 0,
                                        delta: { tool_calls: [argsDelta] },
                                        finish_reason: null
                                    }]
                            };
                            res.write(`data: ${JSON.stringify(argsChunk)}\n\n`);
                            toolCallIndex++;
                            log(`Tool call: ${toolCall.function.name} (${toolCall.function.arguments.length} arg chars)`, 'tool');
                        }
                    }
                    // Send final chunk with appropriate finish_reason
                    const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
                    const finalChunk = {
                        id,
                        object: 'chat.completion.chunk',
                        created,
                        model: model.id,
                        choices: [{
                                index: 0,
                                delta: {},
                                finish_reason: finishReason
                            }]
                    };
                    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                    const responseTokens = Math.ceil(responseChars / 4);
                    const toolInfo = toolCalls.length > 0 ? `, ${toolCalls.length} tool call(s)` : '';
                    log(`Response (stream): ~${responseChars} chars (~${responseTokens} tokens)${toolInfo}`, 'stream');
                    // Log to UI
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/chat/completions',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: responseChars,
                        stream: true,
                        durationMs: Date.now() - startTime,
                        status: 'success'
                    });
                }
                catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Streaming request failed after ${durationMs}ms`, error);
                    const errorMessage = describeRequestError(error);
                    // Send error in proper SSE format with consistent error structure
                    res.write(`data: ${JSON.stringify((0, core_1.createErrorResponse)(errorMessage, 'server_error', 500))}\n\n`);
                    res.end();
                    // Log error to UI
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/chat/completions',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: 0,
                        stream: true,
                        durationMs: Date.now() - startTime,
                        status: 'error',
                        errorMessage: (0, security_1.categorizeError)(error)
                    });
                }
                finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
            }
            else {
                // Non-streaming response
                try {
                    const { response } = await sendRequestWithRetry(model, request.model, vsCodeMessages, options, cancellationSource.token);
                    let content = '';
                    const toolCalls = [];
                    // Use response.stream if available (for tool calling), otherwise fall back to response.text
                    const stream = response.stream || (async function* () {
                        for await (const text of response.text) {
                            yield new vscode.LanguageModelTextPart(text);
                        }
                    })();
                    for await (const part of stream) {
                        if (part instanceof vscode.LanguageModelTextPart) {
                            content += part.value;
                        }
                        else if (part instanceof vscode.LanguageModelToolCallPart) {
                            const toolCall = convertToolCallPart(part);
                            toolCalls.push(toolCall);
                            log(`Tool call: ${toolCall.function.name} (${toolCall.function.arguments.length} arg chars)`, 'tool');
                        }
                    }
                    const responseTokens = Math.ceil(content.length / 4);
                    const toolInfo = toolCalls.length > 0 ? `, ${toolCalls.length} tool call(s)` : '';
                    log(`Response: ~${content.length} chars (~${responseTokens} tokens)${toolInfo}`, 'response');
                    // Build response with or without tool calls
                    const openAIResponse = {
                        id: (0, core_1.generateId)(),
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: model.id,
                        choices: [{
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: toolCalls.length > 0 && !content ? null : content,
                                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                                },
                                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
                            }],
                        usage: {
                            prompt_tokens: 0, // VS Code API doesn't expose token counts
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Connection': 'close',
                        ...getRequestCorsHeaders(req)
                    });
                    res.end(JSON.stringify(openAIResponse));
                    // Log to UI
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/chat/completions',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: content.length,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'success'
                    });
                }
                catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Non-streaming request failed after ${durationMs}ms`, error);
                    const errorMessage = describeRequestError(error);
                    if (error instanceof CopilotNotReadyError) {
                        sendErrorResponse(res, 503, errorMessage, 'service_unavailable');
                    }
                    else {
                        sendErrorResponse(res, 500, errorMessage, 'server_error');
                    }
                    // Log error to UI
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/chat/completions',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: 0,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'error',
                        errorMessage: (0, security_1.categorizeError)(error)
                    });
                }
                finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
            }
        }
        catch (error) {
            logError('Invalid request', error);
            const errorMessage = error instanceof Error ? error.message : 'Invalid JSON';
            sendErrorResponse(res, 400, errorMessage, 'invalid_request_error');
        }
    });
}
// ============================================================================
// Anthropic Messages API Handler
// ============================================================================
/**
 * Sends a standardized Anthropic error response.
 */
function sendAnthropicErrorResponse(res, statusCode, message, type) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify((0, core_1.createAnthropicErrorResponse)(message, type)));
}
/**
 * Converts Anthropic tool definitions to VS Code tool format for merging.
 */
async function mergeAnthropicWithVSCodeTools(requestTools, useVSCodeTools) {
    const tools = requestTools ? (0, core_1.convertAnthropicToolsToInternal)(requestTools) : [];
    if (useVSCodeTools) {
        const vsCodeTools = await getAvailableTools();
        const existingNames = new Set(tools.map(t => t.function.name));
        for (const vsTool of vsCodeTools) {
            if (!existingNames.has(vsTool.name)) {
                tools.push({
                    type: 'function',
                    function: {
                        name: vsTool.name,
                        description: vsTool.description,
                        parameters: vsTool.inputSchema
                    }
                });
            }
        }
    }
    return tools;
}
/**
 * Writes an Anthropic SSE event.
 */
function writeAnthropicSSE(res, event) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
async function handleAnthropicMessages(req, res) {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    const startTime = Date.now();
    req.setTimeout(core_1.REQUEST_TIMEOUT_MS, () => {
        if (!aborted) {
            aborted = true;
            logError(`Anthropic request timed out after ${core_1.REQUEST_TIMEOUT_MS}ms`);
            sendAnthropicErrorResponse(res, 408, 'Request timeout', 'timeout_error');
            req.destroy();
        }
    });
    req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > core_1.MAX_REQUEST_BODY_SIZE) {
            aborted = true;
            logError(`Anthropic request body too large: ${bodySize} bytes`);
            sendAnthropicErrorResponse(res, 413, 'Request body too large', 'invalid_request_error');
            req.destroy();
            return;
        }
        body += chunk.toString();
    });
    req.on('end', async () => {
        if (aborted)
            return;
        try {
            const parsed = (0, core_1.parseAnthropicRequestBody)(body);
            if (!parsed) {
                logError('Invalid JSON in Anthropic request body');
                sendAnthropicErrorResponse(res, 400, 'Invalid JSON in request body', 'invalid_request_error');
                return;
            }
            const validationError = (0, core_1.validateAnthropicRequest)(parsed);
            if (validationError) {
                logError(`Anthropic request validation failed: ${validationError}`);
                sendAnthropicErrorResponse(res, 400, validationError, 'invalid_request_error');
                return;
            }
            const request = parsed;
            const requestId = (0, core_1.generateAnthropicId)();
            const model = await getModel(request.model);
            // Convert Anthropic messages to internal format
            const internalMessages = (0, core_1.convertAnthropicToInternal)(request);
            const messageCount = internalMessages.length;
            const totalChars = internalMessages.reduce((sum, m) => sum + (0, core_1.getTextContent)(m.content).length, 0);
            const estimatedTokens = Math.ceil(totalChars / 4);
            const requestedModel = request.model || '(default)';
            if (!model) {
                logError(`No language models available for Anthropic request (requested: ${requestedModel})`);
                sendAnthropicErrorResponse(res, 503, 'No language models available. Make sure GitHub Copilot is installed and authenticated, then open Copilot Chat once (type a message and stop) and retry.', 'api_error');
                return;
            }
            // Prepare tools
            const allTools = await mergeAnthropicWithVSCodeTools(request.tools, request.use_vscode_tools ?? false);
            const hasTools = allTools.length > 0;
            log(`Anthropic request: ${messageCount} msgs, ~${estimatedTokens} tokens, stream: ${request.stream ?? false}${hasTools ? `, ${allTools.length} tools` : ''}`, 'request');
            log(`Model: ${requestedModel} → ${model.name} (${model.id})`, 'model');
            const vsCodeMessages = convertToVSCodeMessages(internalMessages);
            // Create cancellation token with timeout
            // Non-streaming/auto-execute: absolute 5-min deadline
            // Streaming: replaced below with activity-based inactivity timeout
            const cancellationSource = new vscode.CancellationTokenSource();
            let timeoutId = setTimeout(() => cancellationSource.cancel(), core_1.REQUEST_TIMEOUT_MS);
            // Build request options
            const options = {};
            if (hasTools) {
                options.tools = convertToVSCodeTools(allTools);
                if (request.tool_choice?.type === 'any') {
                    options.toolMode = vscode.LanguageModelChatToolMode.Required;
                }
            }
            // Handle auto-execute mode
            const anthropicAutoToolConfig = vscode.workspace.getConfiguration('copilotProxy');
            const anthropicAllowAutoToolExecution = anthropicAutoToolConfig.get('allowAutoToolExecution', false);
            if ((0, security_1.isAutoExecutionAllowed)(request.tool_execution, anthropicAllowAutoToolExecution) && hasTools) {
                log('Anthropic auto-execute mode enabled', 'tool');
                const maxRounds = (0, security_1.validateMaxToolRounds)(request.max_tool_rounds);
                if (maxRounds === null) {
                    sendAnthropicErrorResponse(res, 400, 'max_tool_rounds must be an integer between 1 and 100', 'invalid_request_error');
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                    return;
                }
                try {
                    const result = await runAutoExecuteLoop(model, request.model, vsCodeMessages, options, maxRounds, cancellationSource.token);
                    log(`Anthropic auto-execute response: ~${result.content.length} chars, ${result.toolCallsExecuted} tool call(s)`);
                    const anthropicResponse = (0, core_1.createAnthropicResponse)(requestId, model.id, result.content);
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Connection': 'close',
                        ...getRequestCorsHeaders(req)
                    });
                    res.end(JSON.stringify(anthropicResponse));
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/messages',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: result.content.length,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'success'
                    });
                }
                catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Anthropic auto-execute failed after ${durationMs}ms`, error);
                    const errorMessage = describeRequestError(error);
                    if (error instanceof CopilotNotReadyError) {
                        sendAnthropicErrorResponse(res, 503, errorMessage, 'api_error');
                    }
                    else {
                        sendAnthropicErrorResponse(res, 500, errorMessage, 'api_error');
                    }
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/messages',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: 0,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'error',
                        errorMessage: (0, security_1.categorizeError)(error)
                    });
                }
                finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
                return;
            }
            if (request.stream) {
                // Anthropic streaming response
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...getRequestCorsHeaders(req)
                });
                // Replace absolute deadline with activity-based inactivity timeout
                clearTimeout(timeoutId);
                const resetStreamTimeout = () => {
                    clearTimeout(timeoutId);
                    timeoutId = setTimeout(() => cancellationSource.cancel(), core_1.STREAM_INACTIVITY_TIMEOUT_MS);
                };
                resetStreamTimeout();
                // Cancel model request when client disconnects
                res.on('close', () => cancellationSource.cancel());
                // Disable socket-level timeout and its destroy callback for long-running streams
                req.setTimeout(0);
                req.socket?.setTimeout(0);
                try {
                    const { response } = await sendRequestWithRetry(model, request.model, vsCodeMessages, options, cancellationSource.token);
                    // Send message_start event
                    const initialMessage = {
                        id: requestId,
                        type: 'message',
                        role: 'assistant',
                        content: [],
                        model: model.id,
                        stop_reason: null,
                        stop_sequence: null,
                        usage: { input_tokens: 0, output_tokens: 0 }
                    };
                    writeAnthropicSSE(res, { type: 'message_start', message: initialMessage });
                    // Send ping
                    writeAnthropicSSE(res, { type: 'ping' });
                    let responseChars = 0;
                    const toolCalls = [];
                    let contentBlockIndex = 0;
                    let textBlockStarted = false;
                    const stream = response.stream || (async function* () {
                        for await (const text of response.text) {
                            yield new vscode.LanguageModelTextPart(text);
                        }
                    })();
                    for await (const part of stream) {
                        resetStreamTimeout();
                        if (part instanceof vscode.LanguageModelTextPart) {
                            const text = part.value;
                            responseChars += text.length;
                            // Start text content block if not started
                            if (!textBlockStarted) {
                                writeAnthropicSSE(res, {
                                    type: 'content_block_start',
                                    index: contentBlockIndex,
                                    content_block: { type: 'text', text: '' }
                                });
                                textBlockStarted = true;
                            }
                            // Send text delta
                            writeAnthropicSSE(res, {
                                type: 'content_block_delta',
                                index: contentBlockIndex,
                                delta: { type: 'text_delta', text }
                            });
                        }
                        else if (part instanceof vscode.LanguageModelToolCallPart) {
                            // Close text block if open
                            if (textBlockStarted) {
                                writeAnthropicSSE(res, { type: 'content_block_stop', index: contentBlockIndex });
                                contentBlockIndex++;
                                textBlockStarted = false;
                            }
                            const toolCall = convertToolCallPart(part);
                            toolCalls.push(toolCall);
                            let input = {};
                            try {
                                input = JSON.parse(toolCall.function.arguments);
                            }
                            catch {
                                // keep empty
                            }
                            // Send tool_use content block
                            writeAnthropicSSE(res, {
                                type: 'content_block_start',
                                index: contentBlockIndex,
                                content_block: {
                                    type: 'tool_use',
                                    id: toolCall.id,
                                    name: toolCall.function.name,
                                    input: {}
                                }
                            });
                            // Send input as json delta
                            writeAnthropicSSE(res, {
                                type: 'content_block_delta',
                                index: contentBlockIndex,
                                delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) }
                            });
                            writeAnthropicSSE(res, { type: 'content_block_stop', index: contentBlockIndex });
                            contentBlockIndex++;
                            log(`Anthropic tool call: ${toolCall.function.name} (${toolCall.function.arguments.length} arg chars)`, 'tool');
                        }
                    }
                    // Close text block if still open
                    if (textBlockStarted) {
                        writeAnthropicSSE(res, { type: 'content_block_stop', index: contentBlockIndex });
                    }
                    // Send message_delta with stop_reason
                    const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
                    writeAnthropicSSE(res, {
                        type: 'message_delta',
                        delta: { stop_reason: stopReason },
                        usage: { output_tokens: Math.ceil(responseChars / 4) }
                    });
                    // Send message_stop
                    writeAnthropicSSE(res, { type: 'message_stop' });
                    res.end();
                    const responseTokens = Math.ceil(responseChars / 4);
                    const toolInfo = toolCalls.length > 0 ? `, ${toolCalls.length} tool call(s)` : '';
                    log(`Anthropic response (stream): ~${responseChars} chars (~${responseTokens} tokens)${toolInfo}`, 'stream');
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/messages',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: responseChars,
                        stream: true,
                        durationMs: Date.now() - startTime,
                        status: 'success'
                    });
                }
                catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Anthropic streaming failed after ${durationMs}ms`, error);
                    const errorMessage = describeRequestError(error);
                    writeAnthropicSSE(res, { type: 'error', error: { type: 'api_error', message: errorMessage } });
                    res.end();
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/messages',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: 0,
                        stream: true,
                        durationMs: Date.now() - startTime,
                        status: 'error',
                        errorMessage: (0, security_1.categorizeError)(error)
                    });
                }
                finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
            }
            else {
                // Non-streaming Anthropic response
                try {
                    const { response } = await sendRequestWithRetry(model, request.model, vsCodeMessages, options, cancellationSource.token);
                    let content = '';
                    const toolCalls = [];
                    const stream = response.stream || (async function* () {
                        for await (const text of response.text) {
                            yield new vscode.LanguageModelTextPart(text);
                        }
                    })();
                    for await (const part of stream) {
                        if (part instanceof vscode.LanguageModelTextPart) {
                            content += part.value;
                        }
                        else if (part instanceof vscode.LanguageModelToolCallPart) {
                            const toolCall = convertToolCallPart(part);
                            toolCalls.push(toolCall);
                            log(`Anthropic tool call: ${toolCall.function.name} (${toolCall.function.arguments.length} arg chars)`, 'tool');
                        }
                    }
                    const responseTokens = Math.ceil(content.length / 4);
                    const toolInfo = toolCalls.length > 0 ? `, ${toolCalls.length} tool call(s)` : '';
                    log(`Anthropic response: ~${content.length} chars (~${responseTokens} tokens)${toolInfo}`, 'response');
                    const anthropicResponse = (0, core_1.createAnthropicResponse)(requestId, model.id, content, toolCalls.length > 0 ? toolCalls : undefined);
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Connection': 'close',
                        ...getRequestCorsHeaders(req)
                    });
                    res.end(JSON.stringify(anthropicResponse));
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/messages',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: content.length,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'success'
                    });
                }
                catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Anthropic non-streaming failed after ${durationMs}ms`, error);
                    const errorMessage = describeRequestError(error);
                    if (error instanceof CopilotNotReadyError) {
                        sendAnthropicErrorResponse(res, 503, errorMessage, 'api_error');
                    }
                    else {
                        sendAnthropicErrorResponse(res, 500, errorMessage, 'api_error');
                    }
                    addRequestLog({
                        id: requestId,
                        timestamp: new Date().toISOString(),
                        method: 'POST',
                        endpoint: '/v1/messages',
                        model: model.id,
                        messageCount,
                        inputChars: totalChars,
                        outputChars: 0,
                        stream: false,
                        durationMs: Date.now() - startTime,
                        status: 'error',
                        errorMessage: (0, security_1.categorizeError)(error)
                    });
                }
                finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
            }
        }
        catch (error) {
            logError('Invalid Anthropic request', error);
            const errorMessage = error instanceof Error ? error.message : 'Invalid JSON';
            sendAnthropicErrorResponse(res, 400, errorMessage, 'invalid_request_error');
        }
    });
}
async function handleModels(res, corsHeaders) {
    // Only refresh if cache is stale (TTL expired) or empty
    const cacheAge = Date.now() - modelsLastRefreshed;
    if (cachedModels.length === 0 || cacheAge > core_1.MODEL_CACHE_TTL_MS) {
        await refreshModels();
        log(`Models cache refreshed (was ${cacheAge}ms old)`);
    }
    else {
        log(`Using cached models (${cacheAge}ms old, TTL: ${core_1.MODEL_CACHE_TTL_MS}ms)`);
    }
    const models = cachedModels.map(model => ({
        id: model.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: model.vendor,
        permission: [],
        root: model.id,
        parent: null,
        // Context length fields for OpenAI-compatible clients
        context_length: model.maxInputTokens,
        context_window: model.maxInputTokens,
        // Additional metadata
        name: model.name,
        family: model.family,
        version: model.version,
        maxInputTokens: model.maxInputTokens
    }));
    res.writeHead(200, {
        'Content-Type': 'application/json',
        ...corsHeaders
    });
    res.end(JSON.stringify({
        object: 'list',
        data: models
    }));
}
function handleHealth(res, corsHeaders) {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        ...corsHeaders
    });
    res.end(JSON.stringify({
        status: 'ok',
        models_available: cachedModels.length
    }));
}
function createServer(_port) {
    return http.createServer(async (req, res) => {
        const origin = req.headers.origin;
        const config = vscode.workspace.getConfiguration('copilotProxy');
        const allowedOrigins = config.get('allowedOrigins', []);
        const corsHeaders = (0, security_1.buildCorsHeaders)(origin, allowedOrigins);
        // Handle CORS preflight (no auth check needed for preflight)
        if (req.method === 'OPTIONS') {
            res.writeHead(200, corsHeaders);
            res.end();
            return;
        }
        const url = req.url || '';
        log(`${req.method} ${url}`, 'request');
        // Parse URL to extract path without query params for routing
        const urlPath = url.split('?')[0];
        // Require proxy authentication for every route except the exempt health check.
        // Requests with no Origin header (curl, server-to-server) are still processable,
        // subject to this auth check.
        if (!(0, security_1.isAuthExemptRoute)(req.method || '', urlPath)) {
            const authenticated = await authenticateRequest(req);
            if (!authenticated) {
                res.writeHead(401, {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                });
                res.end(JSON.stringify((0, core_1.createErrorResponse)('Missing or invalid proxy authorization', 'unauthorized', 401)));
                return;
            }
        }
        if (req.method === 'POST' && (urlPath === '/v1/chat/completions' || urlPath === '/chat/completions')) {
            await handleChatCompletion(req, res);
        }
        else if (req.method === 'POST' && (urlPath === '/v1/messages' || urlPath === '/messages')) {
            await handleAnthropicMessages(req, res);
        }
        else if (req.method === 'GET' && (urlPath === '/v1/models' || urlPath === '/models')) {
            await handleModels(res, corsHeaders);
        }
        else if (req.method === 'GET' && (urlPath === '/v1/tools' || urlPath === '/tools')) {
            await handleTools(req, res, corsHeaders);
        }
        else if (req.method === 'GET' && (urlPath === '/health' || urlPath === '/')) {
            handleHealth(res, corsHeaders);
        }
        else {
            sendErrorResponse(res, 404, `Unknown endpoint: ${req.method} ${url}`, 'not_found');
        }
    });
}
async function startServer() {
    log('Starting server...', 'server');
    if (server) {
        logWarn('Server already running, skipping');
        vscode.window.showInformationMessage('Copilot Proxy server is already running');
        return;
    }
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const port = config.get('port', 8080);
    log(`Binding to port ${port}...`, 'server');
    server = createServer(port);
    // Configure server-level timeouts
    // server.timeout = 0: disable server-level socket timeout.
    // Timeouts are managed per-request: absolute deadline for non-streaming,
    // activity-based inactivity timeout for streaming responses.
    server.timeout = 0;
    server.keepAliveTimeout = core_1.KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = core_1.HEADERS_TIMEOUT_MS;
    // Track active connections for clean shutdown
    server.on('connection', (socket) => {
        activeSockets.add(socket);
        log(`New connection (${activeSockets.size} active)`, 'connect');
        socket.on('close', () => {
            activeSockets.delete(socket);
            log(`Connection closed (${activeSockets.size} active)`, 'disconnect');
        });
    });
    server.listen(port, security_1.LOOPBACK_HOST, async () => {
        log(`Server running on 127.0.0.1:${port}`, 'success');
        log(`Endpoint: http://127.0.0.1:${port}/v1/chat/completions`, 'info');
        log(`Endpoint: http://127.0.0.1:${port}/v1/messages (Anthropic)`, 'info');
        // Log available models after server starts
        const models = await refreshModels();
        log(`Loaded ${models.length} model(s):`, 'model');
        for (const m of models) {
            const ctx = m.maxInputTokens?.toLocaleString() ?? '?';
            log(`  └─ ${m.name} (${m.id}): ${ctx} tokens`);
        }
        vscode.window.showInformationMessage(`Copilot Proxy server started on port ${port}`);
        updateStatusBar(port);
        updateStatusPanel();
    });
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            logError(`Port ${port} is already in use`, error);
            vscode.window.showErrorMessage(`Port ${port} is already in use. Try a different port or close other VS Code instances.`);
        }
        else {
            logError('Failed to start server', error);
            vscode.window.showErrorMessage(`Failed to start server: ${error.message}`);
        }
        server = null;
        updateStatusBar();
        updateStatusPanel();
    });
}
function stopServer() {
    if (server) {
        // Destroy all active sockets so server.close() resolves immediately
        for (const socket of activeSockets) {
            socket.destroy();
        }
        activeSockets.clear();
        server.close(() => {
            log('Server stopped', 'server');
            vscode.window.showInformationMessage('Copilot Proxy server stopped');
        });
        server = null;
        updateStatusBar();
        updateStatusPanel();
    }
    else {
        vscode.window.showInformationMessage('Copilot Proxy server is not running');
    }
}
function updateStatusBar(port) {
    if (!statusBarItem)
        return;
    if (port) {
        statusBarItem.text = `$(radio-tower) Copilot Proxy: ${port}`;
        statusBarItem.tooltip = `Copilot Proxy running on port ${port}\n${cachedModels.length} model(s) available\nClick to show status`;
    }
    else {
        statusBarItem.text = `$(circle-slash) Copilot Proxy: Off`;
        statusBarItem.tooltip = 'Copilot Proxy is not running\nClick to show status';
    }
}
function getWebviewContent(isRunning, port, models, settings, logs = [], session = (0, core_1.emptyStats)(), lifetime = (0, core_1.emptyStats)()) {
    const statusColor = isRunning ? '#4caf50' : '#9e9e9e';
    const statusText = isRunning ? `Running on 127.0.0.1:${port}` : 'Stopped';
    const buttonText = isRunning ? 'Stop Server' : 'Start Server';
    const buttonCommand = isRunning ? 'stop' : 'start';
    const modelCards = models.map(model => `
        <div class="model-card">
            <div class="model-name">${(0, core_1.escapeHtml)(model.name)}</div>
            <div class="model-meta">
                <span class="model-id">${(0, core_1.escapeHtml)(model.id)}</span>
                <span class="separator">-</span>
                <span class="model-vendor">${(0, core_1.escapeHtml)(model.vendor)}</span>
            </div>
            <div class="model-details">
                <span class="detail-label">Family:</span> ${(0, core_1.escapeHtml)(model.family)}
                <span class="separator">|</span>
                <span class="detail-label">Max tokens:</span> ${model.maxInputTokens.toLocaleString()}
            </div>
        </div>
    `).join('');
    const endpoints = isRunning ? `
        <div class="section">
            <div class="section-header">Endpoints</div>
            <div class="endpoints">
                <div class="endpoint">
                    <span class="method post">POST</span>
                    <code>http://127.0.0.1:${port}/v1/chat/completions</code>
                    <button class="copy-btn" data-url="http://127.0.0.1:${port}/v1/chat/completions" title="Copy URL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>
                    <code>http://127.0.0.1:${port}/v1/messages</code>
                    <button class="copy-btn" data-url="http://127.0.0.1:${port}/v1/messages" title="Copy URL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <code>http://127.0.0.1:${port}/v1/models</code>
                    <button class="copy-btn" data-url="http://127.0.0.1:${port}/v1/models" title="Copy URL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <code>http://127.0.0.1:${port}/health</code>
                    <button class="copy-btn" data-url="http://127.0.0.1:${port}/health" title="Copy URL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    ` : '';
    const fmtAvg = (s) => s.total > 0 ? `${Math.round(s.durationMsSum / s.total)}ms` : '-';
    const statsRow = (label, sVal, lVal) => `
        <tr>
            <td class="stats-label">${(0, core_1.escapeHtml)(label)}</td>
            <td class="stats-value">${typeof sVal === 'number' ? sVal.toLocaleString() : (0, core_1.escapeHtml)(sVal)}</td>
            <td class="stats-value">${typeof lVal === 'number' ? lVal.toLocaleString() : (0, core_1.escapeHtml)(lVal)}</td>
        </tr>
    `;
    const errorCell = (n) => `<td class="stats-value${n > 0 ? ' stats-error-cell' : ''}">${n.toLocaleString()}</td>`;
    const errorsRow = `
        <tr>
            <td class="stats-label">Errors</td>
            ${errorCell(session.error)}
            ${errorCell(lifetime.error)}
        </tr>
    `;
    const statsSection = `
        <div class="section">
            <div class="section-header">Stats</div>
            <table class="stats-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>Session</th>
                        <th>Lifetime</th>
                    </tr>
                </thead>
                <tbody>
                    ${statsRow('Total requests', session.total, lifetime.total)}
                    ${statsRow('Successful', session.success, lifetime.success)}
                    ${errorsRow}
                    ${statsRow('OpenAI API', session.openai, lifetime.openai)}
                    ${statsRow('Anthropic API', session.anthropic, lifetime.anthropic)}
                    ${statsRow('Input chars', session.inputChars, lifetime.inputChars)}
                    ${statsRow('Output chars', session.outputChars, lifetime.outputChars)}
                    ${statsRow('Avg duration', fmtAvg(session), fmtAvg(lifetime))}
                </tbody>
            </table>
        </div>
    `;
    // Per-model breakdown: union of model keys seen in either session or lifetime,
    // sorted by lifetime request count (desc) so the busiest models surface first.
    const fmtModelAvg = (m) => m.total > 0 ? `${Math.round(m.durationMsSum / m.total)}ms` : '-';
    const modelKeys = Array.from(new Set([
        ...Object.keys(session.byModel ?? {}),
        ...Object.keys(lifetime.byModel ?? {})
    ])).sort((a, b) => {
        const la = lifetime.byModel?.[a]?.total ?? 0;
        const lb = lifetime.byModel?.[b]?.total ?? 0;
        if (lb !== la) {
            return lb - la;
        }
        return a.localeCompare(b);
    });
    const modelStatsRows = modelKeys.map(key => {
        const s = session.byModel?.[key] ?? (0, core_1.emptyModelStats)();
        const l = lifetime.byModel?.[key] ?? (0, core_1.emptyModelStats)();
        const reqCell = (m) => `<td class="stats-value">${m.total.toLocaleString()}${m.error > 0 ? ` <span class="stats-error-cell">(${m.error.toLocaleString()} err)</span>` : ''}</td>`;
        return `
        <tr>
            <td class="stats-label" title="${(0, core_1.escapeHtml)(key)}">${(0, core_1.escapeHtml)(key)}</td>
            ${reqCell(s)}
            ${reqCell(l)}
            <td class="stats-value">${fmtModelAvg(l)}</td>
        </tr>`;
    }).join('');
    const modelStatsSection = modelKeys.length > 0 ? `
        <div class="section">
            <div class="section-header">Stats by Model</div>
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Model</th>
                        <th>Session</th>
                        <th>Lifetime</th>
                        <th>Avg</th>
                    </tr>
                </thead>
                <tbody>
                    ${modelStatsRows}
                </tbody>
            </table>
        </div>
    ` : '';
    const modelOptions = models.map(m => `<option value="${(0, core_1.escapeHtml)(m.id)}" ${settings?.defaultModel === m.id ? 'selected' : ''}>${(0, core_1.escapeHtml)(m.name)}</option>`).join('');
    const settingsSection = settings ? `
        <div class="section">
            <div class="section-header">Settings</div>
            <div class="settings-grid">
                <div class="setting-item">
                    <label class="setting-label" for="portInput">Port</label>
                    <input type="number" id="portInput" class="setting-input" value="${settings.port}" min="1" max="65535" />
                </div>
                <div class="setting-item">
                    <label class="setting-label" for="autoStartInput">Auto Start</label>
                    <input type="checkbox" id="autoStartInput" class="setting-checkbox" ${settings.autoStart ? 'checked' : ''} />
                </div>
                <div class="setting-item">
                    <label class="setting-label" for="defaultModelInput">Default Model</label>
                    <select id="defaultModelInput" class="setting-select">
                        <option value="" ${!settings.defaultModel ? 'selected' : ''}>(first available)</option>
                        ${modelOptions}
                    </select>
                </div>
                <div class="setting-item">
                    <label class="setting-label" for="logRequestsInput">Log Requests to UI</label>
                    <input type="checkbox" id="logRequestsInput" class="setting-checkbox" ${settings.logRequestsToUI ? 'checked' : ''} />
                </div>
            </div>
        </div>
    ` : '';
    // Generate logs section
    const logsSection = logs.length > 0 ? `
        <div class="section logs-section">
            <div class="section-header">
                Request Logs (${logs.length})
                <button class="secondary-btn" id="clearLogsBtn">Clear</button>
            </div>
            <div class="logs-table-container">
                <table class="logs-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>API</th>
                            <th>Model</th>
                            <th>Msgs</th>
                            <th>In</th>
                            <th>Out</th>
                            <th>Stream</th>
                            <th>Duration</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const statusClass = entry.status === 'success' ? 'status-success' : 'status-error';
        const statusIcon = entry.status === 'success' ? '✓' : '✗';
        const apiType = entry.endpoint.includes('messages') ? 'Anthropic' : 'OpenAI';
        const apiClass = apiType === 'Anthropic' ? 'api-anthropic' : 'api-openai';
        return `
                                <tr class="${statusClass}">
                                    <td class="log-time">${(0, core_1.escapeHtml)(time)}</td>
                                    <td class="log-api"><span class="api-badge ${apiClass}">${apiType}</span></td>
                                    <td class="log-model" title="${(0, core_1.escapeHtml)(entry.model)}">${(0, core_1.escapeHtml)(entry.model.split('/').pop() || entry.model)}</td>
                                    <td class="log-num">${entry.messageCount}</td>
                                    <td class="log-num">${entry.inputChars.toLocaleString()}</td>
                                    <td class="log-num">${entry.outputChars.toLocaleString()}</td>
                                    <td class="log-stream">${entry.stream ? 'Yes' : 'No'}</td>
                                    <td class="log-duration">${entry.durationMs}ms</td>
                                    <td class="log-status">${statusIcon}${entry.errorMessage ? ` <span title="${(0, core_1.escapeHtml)(entry.errorMessage)}">!</span>` : ''}</td>
                                </tr>
                            `;
    }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    ` : (settings?.logRequestsToUI ? `
        <div class="section logs-section">
            <div class="section-header">Request Logs (0)</div>
            <div class="empty-state">No requests logged yet</div>
        </div>
    ` : '');
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copilot Proxy Status</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.5;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .title {
            font-size: 1.4em;
            font-weight: 600;
        }
        .main-layout {
            display: flex;
            gap: 24px;
            align-items: stretch;
        }
        .left-column {
            flex: 0 0 280px;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }
        .right-column {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }
        .status-row {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: ${statusColor};
        }
        .status-text {
            font-weight: 500;
        }
        .action-btn {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
        }
        .action-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .secondary-btn {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
        }
        .secondary-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .section {
            margin-bottom: 24px;
        }
        .status-row + .section {
            margin-top: 24px;
        }
        .section-header {
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
        }
        .model-card {
            padding: 12px;
            margin-bottom: 8px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            border-left: 3px solid var(--vscode-focusBorder);
        }
        .model-name {
            font-weight: 600;
            margin-bottom: 4px;
        }
        .model-meta {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
        .model-id {
            font-family: var(--vscode-editor-font-family);
        }
        .model-details {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .detail-label {
            color: var(--vscode-foreground);
            opacity: 0.8;
        }
        .separator {
            margin: 0 6px;
            opacity: 0.5;
        }
        .endpoints {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .endpoint {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }
        .method {
            font-size: 0.75em;
            font-weight: 600;
            padding: 3px 6px;
            border-radius: 3px;
            min-width: 42px;
            text-align: center;
        }
        .method.post {
            background: #2e7d32;
            color: #fff;
        }
        .method.get {
            background: #1565c0;
            color: #fff;
        }
        .endpoint code {
            flex: 1;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            color: var(--vscode-textLink-foreground);
        }
        .copy-btn {
            background: transparent;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: var(--vscode-foreground);
            opacity: 0.6;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .copy-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }
        .copy-btn.copied {
            color: #4caf50;
            opacity: 1;
        }
        .empty-state {
            text-align: center;
            padding: 24px;
            color: var(--vscode-descriptionForeground);
        }
        .stats-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            overflow: hidden;
        }
        .stats-table th,
        .stats-table td {
            padding: 6px 12px;
            text-align: right;
            font-size: 0.9em;
        }
        .stats-table th {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
        }
        .stats-table th:first-child,
        .stats-table .stats-label {
            text-align: left;
            color: var(--vscode-descriptionForeground);
        }
        .stats-table .stats-value {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-foreground);
        }
        .stats-table .stats-error-cell {
            color: #f44336;
        }
        .settings-grid {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }
        .setting-label {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }
        .setting-value {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-foreground);
        }
        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 24px;
        }
        .setting-input {
            width: 80px;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        .setting-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        .setting-select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border, transparent);
            border-radius: 4px;
            font-size: 13px;
            min-width: 150px;
        }
        .setting-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        .setting-checkbox {
            width: 16px;
            height: 16px;
            accent-color: var(--vscode-button-background);
        }
        .refresh-btn {
            background: transparent;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: var(--vscode-foreground);
            opacity: 0.6;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .refresh-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }
        .refresh-btn.spinning svg {
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .logs-section {
            margin-top: 24px;
        }
        .logs-table-container {
            max-height: 300px;
            overflow-y: auto;
            border-radius: 6px;
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .logs-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85em;
        }
        .logs-table th,
        .logs-table td {
            padding: 8px 10px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .logs-table th {
            background: var(--vscode-editor-background);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1;
        }
        .logs-table tr:last-child td {
            border-bottom: none;
        }
        .logs-table .log-time {
            font-family: var(--vscode-editor-font-family);
            white-space: nowrap;
        }
        .logs-table .log-model {
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .logs-table .log-num {
            text-align: right;
            font-family: var(--vscode-editor-font-family);
        }
        .logs-table .log-api {
            white-space: nowrap;
        }
        .api-badge {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 0.8em;
            font-weight: 600;
        }
        .api-badge.api-openai {
            background: rgba(16, 163, 127, 0.2);
            color: #10a37f;
        }
        .api-badge.api-anthropic {
            background: rgba(204, 120, 50, 0.2);
            color: #cc783a;
        }
        .logs-table .log-stream {
            text-align: center;
        }
        .logs-table .log-duration {
            text-align: right;
            font-family: var(--vscode-editor-font-family);
        }
        .logs-table .log-status {
            text-align: center;
        }
        .logs-table tr.status-success .log-status {
            color: #4caf50;
        }
        .logs-table tr.status-error .log-status {
            color: #f44336;
        }
        .logs-table tr.status-error {
            background: rgba(244, 67, 54, 0.1);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="title">Copilot Proxy</span>
            <button class="secondary-btn" id="logsBtn">📋 View Logs</button>
        </div>

        <div class="main-layout">
            <div class="left-column">
                <div class="section">
                    <div class="section-header">
                        Models (${models.length})
                        <button class="refresh-btn" id="refreshModelsBtn" title="Refresh Models">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M23 4v6h-6"></path>
                                <path d="M1 20v-6h6"></path>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                        </button>
                    </div>
                    ${models.length > 0 ? modelCards : '<div class="empty-state">No models available</div>'}
                </div>
            </div>

            <div class="right-column">
                ${settingsSection}

                <div class="status-row">
                    <div class="status-indicator">
                        <div class="status-dot"></div>
                        <span class="status-text">${statusText}</span>
                    </div>
                    <button class="action-btn" id="actionBtn">${buttonText}</button>
                </div>

                ${endpoints}

                ${statsSection}

                ${modelStatsSection}
            </div>
        </div>

        ${logsSection}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('actionBtn').addEventListener('click', () => {
            vscode.postMessage({ command: '${buttonCommand}' });
        });

        document.getElementById('logsBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'showLogs' });
        });

        // Settings handlers
        const portInput = document.getElementById('portInput');
        if (portInput) {
            portInput.addEventListener('change', (e) => {
                const value = parseInt(e.target.value, 10);
                if (value >= 1 && value <= 65535) {
                    vscode.postMessage({ command: 'updateSetting', key: 'port', value: value });
                }
            });
        }

        const autoStartInput = document.getElementById('autoStartInput');
        if (autoStartInput) {
            autoStartInput.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateSetting', key: 'autoStart', value: e.target.checked });
            });
        }

        const defaultModelInput = document.getElementById('defaultModelInput');
        if (defaultModelInput) {
            defaultModelInput.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateSetting', key: 'defaultModel', value: e.target.value });
            });
        }

        const logRequestsInput = document.getElementById('logRequestsInput');
        if (logRequestsInput) {
            logRequestsInput.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateSetting', key: 'logRequestsToUI', value: e.target.checked });
            });
        }

        const clearLogsBtn = document.getElementById('clearLogsBtn');
        if (clearLogsBtn) {
            clearLogsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'clearLogs' });
            });
        }

        const refreshModelsBtn = document.getElementById('refreshModelsBtn');
        if (refreshModelsBtn) {
            refreshModelsBtn.addEventListener('click', () => {
                refreshModelsBtn.classList.add('spinning');
                vscode.postMessage({ command: 'refreshModels' });
            });
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'refreshComplete') {
                const btn = document.getElementById('refreshModelsBtn');
                if (btn) btn.classList.remove('spinning');
            }
        });

        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const url = btn.dataset.url;
                try {
                    await navigator.clipboard.writeText(url);
                    btn.classList.add('copied');
                    setTimeout(() => btn.classList.remove('copied'), 1500);
                } catch (err) {
                    vscode.postMessage({ command: 'copy', text: url });
                }
            });
        });
    </script>
</body>
</html>`;
}
async function showStatus() {
    await refreshModels();
    // If panel already exists, reveal it and update content
    if (statusPanel) {
        statusPanel.reveal(vscode.ViewColumn.One);
        updateStatusPanel();
        return;
    }
    // Create new webview panel
    statusPanel = vscode.window.createWebviewPanel('copilotProxyStatus', 'Copilot Proxy', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
    });
    // Set initial content
    updateStatusPanel();
    // Handle messages from webview
    statusPanel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'start':
                await startServer();
                updateStatusPanel();
                break;
            case 'stop':
                stopServer();
                updateStatusPanel();
                break;
            case 'copy':
                await vscode.env.clipboard.writeText(message.text);
                vscode.window.showInformationMessage('Copied to clipboard');
                break;
            case 'showLogs':
                if (outputChannel) {
                    outputChannel.show(false);
                    // Also execute command to ensure Output panel is visible and focused
                    vscode.commands.executeCommand('workbench.action.output.show.extension-output-local.vscode-copilot-proxy-#1-Copilot Proxy');
                }
                break;
            case 'openSettings':
                vscode.commands.executeCommand('workbench.action.openSettings', 'copilotProxy');
                break;
            case 'updateSetting': {
                const config = vscode.workspace.getConfiguration('copilotProxy');
                await config.update(message.key, message.value, vscode.ConfigurationTarget.Global);
                log(`Setting updated: ${message.key} = ${message.value}`);
                // Refresh panel if logging setting changed
                if (message.key === 'logRequestsToUI') {
                    updateStatusPanel();
                }
                break;
            }
            case 'refreshModels':
                log('Refreshing models...');
                await refreshModels();
                updateStatusPanel();
                // Notify webview that refresh is complete (in case it needs to stop spinner)
                statusPanel?.webview.postMessage({ command: 'refreshComplete' });
                log(`Models refreshed: ${cachedModels.length} available`);
                break;
            case 'clearLogs':
                requestLogs = [];
                log('Request logs cleared');
                updateStatusPanel();
                break;
        }
    });
    // Clean up when panel is closed
    statusPanel.onDidDispose(() => {
        statusPanel = undefined;
    });
}
function updateStatusPanel() {
    if (!statusPanel)
        return;
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const port = config.get('port', 8080);
    const autoStart = config.get('autoStart', true);
    const defaultModel = config.get('defaultModel', '');
    const logRequestsToUI = config.get('logRequestsToUI', false);
    const isRunning = server !== null;
    // Map and sort models alphabetically by name
    const models = cachedModels
        .map(m => ({
        id: m.id,
        name: m.name,
        family: m.family,
        vendor: m.vendor,
        maxInputTokens: m.maxInputTokens
    }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const settings = {
        port,
        autoStart,
        defaultModel,
        logRequestsToUI
    };
    statusPanel.webview.html = getWebviewContent(isRunning, port, models, settings, logRequestsToUI ? requestLogs : [], sessionStats, lifetimeStats);
}
function activate(context) {
    extensionContext = context;
    // Restore lifetime stats from globalState (merge into seed shape so new fields default to 0)
    const stored = context.globalState.get(LIFETIME_STATS_KEY);
    if (stored) {
        lifetimeStats = { ...(0, core_1.emptyStats)(), ...stored };
    }
    // Create log output channel (supports colored log levels)
    outputChannel = vscode.window.createOutputChannel('Copilot Proxy', { log: true });
    context.subscriptions.push(outputChannel);
    // Startup banner
    outputChannel.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    outputChannel.info('  🚀 Copilot Proxy Starting');
    outputChannel.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log(`Version: ${context.extension.packageJSON.version || 'unknown'}`, 'info');
    // Log key settings
    const startupConfig = vscode.workspace.getConfiguration('copilotProxy');
    log(`Port: ${startupConfig.get('port', 8080)}`, 'info');
    log(`Request timeout: ${core_1.REQUEST_TIMEOUT_MS / 1000}s`, 'info');
    log(`Keep-alive timeout: ${core_1.KEEP_ALIVE_TIMEOUT_MS / 1000}s`, 'info');
    const defaultModel = startupConfig.get('defaultModel', '');
    if (defaultModel) {
        log(`Default model: ${defaultModel}`, 'info');
    }
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'copilot-proxy.status';
    statusBarItem.text = '$(circle-slash) Copilot Proxy: Off';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('copilot-proxy.start', startServer), vscode.commands.registerCommand('copilot-proxy.stop', stopServer), vscode.commands.registerCommand('copilot-proxy.status', showStatus), vscode.commands.registerCommand('copilot-proxy.setProxyToken', async () => {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter a new proxy bearer token',
            password: true,
            ignoreFocusOut: true,
            validateInput: v => v.trim().length === 0 ? 'Token cannot be empty' : null
        });
        if (token) {
            await context.secrets.store(PROXY_TOKEN_SECRET_KEY, token);
            vscode.window.showInformationMessage('Copilot Proxy: token updated.');
        }
    }));
    // Listen for model changes
    context.subscriptions.push(vscode.lm.onDidChangeChatModels(() => {
        log('Chat models changed, refreshing...');
        refreshModels();
    }));
    // Auto-start if configured
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const autoStart = config.get('autoStart', true);
    log(`Auto-start: ${autoStart}`, 'info');
    if (autoStart) {
        startServer().catch(err => logError('startServer failed', err));
    }
    log('Extension activated', 'success');
}
function deactivate() {
    if (server) {
        for (const socket of activeSockets) {
            socket.destroy();
        }
        activeSockets.clear();
        server.close();
        server = null;
    }
    if (statusPanel) {
        statusPanel.dispose();
        statusPanel = undefined;
    }
    log('Extension deactivated', 'info');
}
//# sourceMappingURL=extension.js.map