import * as vscode from 'vscode';
import * as http from 'http';
import {
    ChatMessage,
    OpenAIResponse,
    StreamChunk,
    ModelInfo,
    SettingsInfo,
    RequestLogEntry,
    MAX_REQUEST_BODY_SIZE,
    REQUEST_TIMEOUT_MS,
    KEEP_ALIVE_TIMEOUT_MS,
    HEADERS_TIMEOUT_MS,
    MODEL_CACHE_TTL_MS,
    getCorsHeaders,
    isLocalhostOrigin,
    parseRequestBody,
    validateRequest,
    createErrorResponse,
    generateId,
    escapeHtml,
    findBestModel
} from './core';

let server: http.Server | null = null;
let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let statusPanel: vscode.WebviewPanel | undefined;

// Request logs storage (max 50 entries)
const MAX_REQUEST_LOGS = 50;
let requestLogs: RequestLogEntry[] = [];

function addRequestLog(entry: RequestLogEntry): void {
    // Always collect logs
    requestLogs.unshift(entry);
    if (requestLogs.length > MAX_REQUEST_LOGS) {
        requestLogs = requestLogs.slice(0, MAX_REQUEST_LOGS);
    }
    // Always update panel if open (UI decides whether to display logs based on setting)
    if (statusPanel) {
        updateStatusPanel();
    }
}

function log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${message}`;
    console.log(`[Copilot Proxy] ${message}`);
    outputChannel?.appendLine(formatted);
}

function logError(message: string, error?: unknown): void {
    const timestamp = new Date().toLocaleTimeString();
    const errorDetails = error instanceof Error ? error.message : String(error ?? '');
    const formatted = errorDetails
        ? `[${timestamp}] ERROR: ${message} - ${errorDetails}`
        : `[${timestamp}] ERROR: ${message}`;
    console.error(`[Copilot Proxy] ERROR: ${message}`, error);
    outputChannel?.appendLine(formatted);
}

function logRaw(label: string, content: string): void {
    const config = vscode.workspace.getConfiguration('copilotProxy');
    if (!config.get<boolean>('rawLogging', false)) return;

    const timestamp = new Date().toLocaleTimeString();
    const separator = '─'.repeat(60);
    outputChannel?.appendLine(`[${timestamp}] ${separator}`);
    outputChannel?.appendLine(`[${timestamp}] RAW ${label}:`);
    outputChannel?.appendLine(content);
    outputChannel?.appendLine(`[${timestamp}] ${separator}`);
}

/**
 * Sends a standardized HTTP error response.
 * Uses createErrorResponse from core.ts for consistent formatting.
 */
function sendErrorResponse(
    res: http.ServerResponse,
    statusCode: number,
    message: string,
    type: string
): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(createErrorResponse(message, type, statusCode)));
}

// Cache for available models
let cachedModels: vscode.LanguageModelChat[] = [];
let modelsLastRefreshed = 0;

let isRefreshing = false;

async function refreshModels(): Promise<vscode.LanguageModelChat[]> {
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
        const timeoutPromise = new Promise<vscode.LanguageModelChat[]>((_, reject) =>
            setTimeout(() => reject(new Error('Model refresh timed out')), timeoutMs)
        );
        cachedModels = await Promise.race([modelsPromise, timeoutPromise]);
        modelsLastRefreshed = Date.now();
        log(`Found ${cachedModels.length} models`);
        return cachedModels;
    } catch (error) {
        logError('Failed to refresh models', error);
        return cachedModels; // Return existing cache on error
    } finally {
        isRefreshing = false;
    }
}

async function getModel(requestedModel?: string): Promise<vscode.LanguageModelChat | undefined> {
    if (cachedModels.length === 0) {
        await refreshModels();
    }

    // Get default model from VS Code config if no model specified
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const defaultModel = config.get<string>('defaultModel', '');

    // Use findBestModel from core.ts for matching logic
    return findBestModel(requestedModel, cachedModels, defaultModel);
}

function convertToVSCodeMessages(messages: ChatMessage[]): vscode.LanguageModelChatMessage[] {
    // Check for system messages and log warning
    const systemMessageCount = messages.filter(m => m.role === 'system').length;
    if (systemMessageCount > 0) {
        log(`Warning: ${systemMessageCount} system message(s) converted to user role (VS Code LM API limitation)`);
    }

    return messages.map(msg => {
        switch (msg.role) {
            case 'system':
                // VS Code LM API doesn't have a system role - convert to user message
                return vscode.LanguageModelChatMessage.User(msg.content);
            case 'assistant':
                return vscode.LanguageModelChatMessage.Assistant(msg.content);
            case 'user':
            default:
                return vscode.LanguageModelChatMessage.User(msg.content);
        }
    });
}

async function handleChatCompletion(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    let bodySize = 0;
    let aborted = false;
    const startTime = Date.now();

    // Set request timeout
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        if (!aborted) {
            aborted = true;
            logError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
            sendErrorResponse(res, 408, 'Request timeout', 'timeout_error');
            req.destroy();
        }
    });

    req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_REQUEST_BODY_SIZE) {
            aborted = true;
            logError(`Request body too large: ${bodySize} bytes (max: ${MAX_REQUEST_BODY_SIZE})`);
            sendErrorResponse(res, 413, 'Request body too large', 'invalid_request_error');
            req.destroy();
            return;
        }
        body += chunk.toString();
    });

    req.on('end', async () => {
        if (aborted) return;
        try {
            // Parse and validate request
            const parsed = parseRequestBody(body);
            if (!parsed) {
                logError('Invalid JSON in request body');
                sendErrorResponse(res, 400, 'Invalid JSON in request body', 'invalid_request_error');
                return;
            }

            const validationError = validateRequest(parsed);
            if (validationError) {
                logError(`Request validation failed: ${validationError}`);
                sendErrorResponse(res, 400, validationError, 'invalid_request_error');
                return;
            }

            const request = parsed;
            const requestId = generateId();

            // Raw logging of request
            logRaw('REQUEST', JSON.stringify(request, null, 2));

            const model = await getModel(request.model);

            // Calculate context size
            const messageCount = request.messages.length;
            const totalChars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
            const estimatedTokens = Math.ceil(totalChars / 4); // rough estimate: ~4 chars per token

            const requestedModel = request.model || '(default)';

            if (!model) {
                logError(`No language models available (requested: ${requestedModel})`);
                sendErrorResponse(res, 503, 'No language models available. Make sure GitHub Copilot is installed and authenticated.', 'service_unavailable');
                return;
            }

            log(`Request: ${messageCount} msgs, ~${estimatedTokens} tokens, stream: ${request.stream ?? false}`);
            log(`Model: ${requestedModel} → ${model.name} (${model.id})`);

            const vsCodeMessages = convertToVSCodeMessages(request.messages);

            // Create cancellation token with timeout (5 min default)
            const timeoutMs = 300000;
            const cancellationSource = new vscode.CancellationTokenSource();
            const timeoutId = setTimeout(() => cancellationSource.cancel(), timeoutMs);

            const options: vscode.LanguageModelChatRequestOptions = {};

            if (request.stream) {
                // Streaming response
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...getCorsHeaders(req.headers.origin)
                });

                const id = generateId();
                const created = Math.floor(Date.now() / 1000);

                try {
                    const response = await model.sendRequest(vsCodeMessages, options, cancellationSource.token);

                    // Send initial chunk with role
                    const initialChunk: StreamChunk = {
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

                    // Stream content chunks
                    let responseChars = 0;
                    let fullResponse = '';
                    for await (const chunk of response.text) {
                        responseChars += chunk.length;
                        fullResponse += chunk;
                        const streamChunk: StreamChunk = {
                            id,
                            object: 'chat.completion.chunk',
                            created,
                            model: model.id,
                            choices: [{
                                index: 0,
                                delta: { content: chunk },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
                    }

                    // Send final chunk
                    const finalChunk: StreamChunk = {
                        id,
                        object: 'chat.completion.chunk',
                        created,
                        model: model.id,
                        choices: [{
                            index: 0,
                            delta: {},
                            finish_reason: 'stop'
                        }]
                    };
                    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();

                    const responseTokens = Math.ceil(responseChars / 4);
                    log(`Response (stream): ~${responseChars} chars (~${responseTokens} tokens)`);

                    // Raw logging of response
                    logRaw('RESPONSE (stream)', fullResponse);

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
                } catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Streaming request failed after ${durationMs}ms`, error);
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    const errorStack = error instanceof Error ? error.stack : String(error);
                    logRaw('ERROR (stream)', `${errorMessage}\n\nDuration: ${durationMs}ms\n\nStack:\n${errorStack}`);
                    // Send error in proper SSE format with consistent error structure
                    res.write(`data: ${JSON.stringify(createErrorResponse(errorMessage, 'server_error', 500))}\n\n`);
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
                        errorMessage
                    });
                } finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
            } else {
                // Non-streaming response
                try {
                    const response = await model.sendRequest(vsCodeMessages, options, cancellationSource.token);

                    let content = '';
                    for await (const chunk of response.text) {
                        content += chunk;
                    }

                    const responseTokens = Math.ceil(content.length / 4);
                    log(`Response: ~${content.length} chars (~${responseTokens} tokens)`);

                    // Raw logging of response
                    logRaw('RESPONSE', content);

                    const openAIResponse: OpenAIResponse = {
                        id: generateId(),
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: model.id,
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content
                            },
                            finish_reason: 'stop'
                        }],
                        usage: {
                            prompt_tokens: 0,  // VS Code API doesn't expose token counts
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };

                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Connection': 'close',
                        ...getCorsHeaders(req.headers.origin)
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
                } catch (error) {
                    const durationMs = Date.now() - startTime;
                    logError(`Non-streaming request failed after ${durationMs}ms`, error);
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    const errorStack = error instanceof Error ? error.stack : String(error);
                    logRaw('ERROR', `${errorMessage}\n\nDuration: ${durationMs}ms\n\nStack:\n${errorStack}`);
                    sendErrorResponse(res, 500, errorMessage, 'server_error');

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
                        errorMessage
                    });
                } finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
            }
        } catch (error) {
            logError('Invalid request', error);
            const errorMessage = error instanceof Error ? error.message : 'Invalid JSON';
            sendErrorResponse(res, 400, errorMessage, 'invalid_request_error');
        }
    });
}

async function handleModels(res: http.ServerResponse, corsHeaders: Record<string, string>): Promise<void> {
    // Only refresh if cache is stale (TTL expired) or empty
    const cacheAge = Date.now() - modelsLastRefreshed;
    if (cachedModels.length === 0 || cacheAge > MODEL_CACHE_TTL_MS) {
        await refreshModels();
        log(`Models cache refreshed (was ${cacheAge}ms old)`);
    } else {
        log(`Using cached models (${cacheAge}ms old, TTL: ${MODEL_CACHE_TTL_MS}ms)`);
    }

    const models = cachedModels.map(model => ({
        id: model.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: model.vendor,
        permission: [],
        root: model.id,
        parent: null,
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

function handleHealth(res: http.ServerResponse, corsHeaders: Record<string, string>): void {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        ...corsHeaders
    });
    res.end(JSON.stringify({
        status: 'ok',
        models_available: cachedModels.length
    }));
}

function createServer(_port: number): http.Server {
    return http.createServer(async (req, res) => {
        const origin = req.headers.origin;
        const corsHeaders = getCorsHeaders(origin);

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(200, corsHeaders);
            res.end();
            return;
        }

        // Block requests from non-localhost origins (browser security)
        if (origin && !isLocalhostOrigin(origin)) {
            log(`Blocked request from non-localhost origin: ${origin}`);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Forbidden: non-localhost origin', type: 'forbidden' } }));
            return;
        }

        const url = req.url || '';

        log(`${req.method} ${url}`);

        if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
            await handleChatCompletion(req, res);
        } else if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
            await handleModels(res, corsHeaders);
        } else if (req.method === 'GET' && (url === '/health' || url === '/')) {
            handleHealth(res, corsHeaders);
        } else {
            sendErrorResponse(res, 404, `Unknown endpoint: ${req.method} ${url}`, 'not_found');
        }
    });
}

async function startServer(): Promise<void> {
    log('startServer() called');
    if (server) {
        log('Server already running, skipping');
        vscode.window.showInformationMessage('Copilot Proxy server is already running');
        return;
    }

    const config = vscode.workspace.getConfiguration('copilotProxy');
    const port = config.get<number>('port', 8080);
    log(`Attempting to start on port ${port}`);

    server = createServer(port);

    // Configure server-level timeouts
    server.timeout = REQUEST_TIMEOUT_MS;
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;

    // Track active connections for debugging
    let connectionCount = 0;
    server.on('connection', (socket) => {
        connectionCount++;
        log(`New connection (${connectionCount} active)`);
        socket.on('close', () => {
            connectionCount--;
            log(`Connection closed (${connectionCount} active)`);
        });
    });

    server.listen(port, '127.0.0.1', async () => {
        log(`Server started on 127.0.0.1:${port}`);
        log(`Endpoint: http://127.0.0.1:${port}/v1/chat/completions`);

        // Log available models after server starts
        const models = await refreshModels();
        log(`Loaded ${models.length} model(s):`);
        for (const m of models) {
            const ctx = m.maxInputTokens?.toLocaleString() ?? '?';
            log(`  - ${m.name} (${m.id}): ${ctx} tokens`);
        }

        vscode.window.showInformationMessage(`Copilot Proxy server started on port ${port}`);
        updateStatusBar(port);
        updateStatusPanel();
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            logError(`Port ${port} is already in use`, error);
            vscode.window.showErrorMessage(`Port ${port} is already in use. Try a different port or close other VS Code instances.`);
        } else {
            logError('Failed to start server', error);
            vscode.window.showErrorMessage(`Failed to start server: ${error.message}`);
        }
        server = null;
        updateStatusBar();
        updateStatusPanel();
    });
}

function stopServer(): void {
    if (server) {
        server.close(() => {
            log('Server stopped');
            vscode.window.showInformationMessage('Copilot Proxy server stopped');
        });
        server = null;
        updateStatusBar();
        updateStatusPanel();
    } else {
        vscode.window.showInformationMessage('Copilot Proxy server is not running');
    }
}

function updateStatusBar(port?: number): void {
    if (!statusBarItem) return;
    if (port) {
        statusBarItem.text = `$(radio-tower) Copilot Proxy: ${port}`;
        statusBarItem.tooltip = `Copilot Proxy running on port ${port}\n${cachedModels.length} model(s) available\nClick to show status`;
    } else {
        statusBarItem.text = `$(circle-slash) Copilot Proxy: Off`;
        statusBarItem.tooltip = 'Copilot Proxy is not running\nClick to show status';
    }
}

function getWebviewContent(isRunning: boolean, port: number, models: ModelInfo[], settings?: SettingsInfo, logs: RequestLogEntry[] = []): string {
    const statusColor = isRunning ? '#4caf50' : '#9e9e9e';
    const statusText = isRunning ? `Running on 127.0.0.1:${port}` : 'Stopped';
    const buttonText = isRunning ? 'Stop Server' : 'Start Server';
    const buttonCommand = isRunning ? 'stop' : 'start';

    const modelCards = models.map(model => `
        <div class="model-card">
            <div class="model-name">${escapeHtml(model.name)}</div>
            <div class="model-meta">
                <span class="model-id">${escapeHtml(model.id)}</span>
                <span class="separator">-</span>
                <span class="model-vendor">${escapeHtml(model.vendor)}</span>
            </div>
            <div class="model-details">
                <span class="detail-label">Family:</span> ${escapeHtml(model.family)}
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

    const modelOptions = models.map(m =>
        `<option value="${escapeHtml(m.id)}" ${settings?.defaultModel === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');

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
                <div class="setting-item">
                    <label class="setting-label" for="rawLoggingInput">Raw Logging (verbose)</label>
                    <input type="checkbox" id="rawLoggingInput" class="setting-checkbox" ${settings.rawLogging ? 'checked' : ''} />
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
                            return `
                                <tr class="${statusClass}">
                                    <td class="log-time">${escapeHtml(time)}</td>
                                    <td class="log-model" title="${escapeHtml(entry.model)}">${escapeHtml(entry.model.split('/').pop() || entry.model)}</td>
                                    <td class="log-num">${entry.messageCount}</td>
                                    <td class="log-num">${entry.inputChars.toLocaleString()}</td>
                                    <td class="log-num">${entry.outputChars.toLocaleString()}</td>
                                    <td class="log-stream">${entry.stream ? 'Yes' : 'No'}</td>
                                    <td class="log-duration">${entry.durationMs}ms</td>
                                    <td class="log-status">${statusIcon}${entry.errorMessage ? ` <span title="${escapeHtml(entry.errorMessage)}">!</span>` : ''}</td>
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

        const rawLoggingInput = document.getElementById('rawLoggingInput');
        if (rawLoggingInput) {
            rawLoggingInput.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateSetting', key: 'rawLogging', value: e.target.checked });
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

async function showStatus(): Promise<void> {
    await refreshModels();

    // If panel already exists, reveal it and update content
    if (statusPanel) {
        statusPanel.reveal(vscode.ViewColumn.One);
        updateStatusPanel();
        return;
    }

    // Create new webview panel
    statusPanel = vscode.window.createWebviewPanel(
        'copilotProxyStatus',
        'Copilot Proxy',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

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

function updateStatusPanel(): void {
    if (!statusPanel) return;

    const config = vscode.workspace.getConfiguration('copilotProxy');
    const port = config.get<number>('port', 8080);
    const autoStart = config.get<boolean>('autoStart', true);
    const defaultModel = config.get<string>('defaultModel', '');
    const logRequestsToUI = config.get<boolean>('logRequestsToUI', false);
    const rawLogging = config.get<boolean>('rawLogging', false);
    const isRunning = server !== null;

    // Map and sort models alphabetically by name
    const models: ModelInfo[] = cachedModels
        .map(m => ({
            id: m.id,
            name: m.name,
            family: m.family,
            vendor: m.vendor,
            maxInputTokens: m.maxInputTokens
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const settings: SettingsInfo = {
        port,
        autoStart,
        defaultModel,
        logRequestsToUI,
        rawLogging
    };

    statusPanel.webview.html = getWebviewContent(isRunning, port, models, settings, logRequestsToUI ? requestLogs : []);
}

export function activate(context: vscode.ExtensionContext): void {
    // Create output channel first so log() works
    outputChannel = vscode.window.createOutputChannel('Copilot Proxy');
    context.subscriptions.push(outputChannel);
    outputChannel.show(true); // Show output channel on startup (preserveFocus: true)

    log('=== Copilot Proxy Starting ===');
    log(`Extension version: ${context.extension.packageJSON.version || 'unknown'}`);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'copilot-proxy.status';
    statusBarItem.text = '$(circle-slash) Copilot Proxy: Off';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-proxy.start', startServer),
        vscode.commands.registerCommand('copilot-proxy.stop', stopServer),
        vscode.commands.registerCommand('copilot-proxy.status', showStatus)
    );

    // Listen for model changes
    context.subscriptions.push(
        vscode.lm.onDidChangeChatModels(() => {
            log('Chat models changed, refreshing...');
            refreshModels();
        })
    );

    // Auto-start if configured
    const config = vscode.workspace.getConfiguration('copilotProxy');
    const autoStart = config.get<boolean>('autoStart', true);
    log(`Auto-start: ${autoStart}`);
    if (autoStart) {
        log('Calling startServer...');
        startServer().catch(err => logError('startServer failed', err));
    }

    log('Extension activated');
}

export function deactivate(): void {
    if (server) {
        server.close();
        server = null;
    }
    if (statusPanel) {
        statusPanel.dispose();
        statusPanel = undefined;
    }
    log('Extension deactivated');
}
