/**
 * Core utility functions for the Copilot Proxy extension.
 * These are pure functions that can be easily unit tested.
 *
 * @see docs/features/copilot-proxy/design.md - Core proxy architecture
 * @see docs/features/code-health-refactor/design.md - Refactoring history
 * @see docs/features/security-hardening/design.md - Security features
 * @see docs/SOURCE_MAPPING.md - Source file to feature mapping
 */

/**
 * Maximum allowed request body size (10MB).
 * Prevents memory exhaustion from oversized requests.
 */
export const MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Request timeout in milliseconds (5 minutes).
 * Absolute deadline for non-streaming requests and auto-execute.
 * Must be long enough for large LLM requests (60K+ tokens).
 */
export const REQUEST_TIMEOUT_MS = 300000;

/**
 * Stream inactivity timeout in milliseconds (30 minutes).
 * For streaming responses, this resets on each chunk received from the model.
 * Unlike REQUEST_TIMEOUT_MS (absolute deadline), this only fires if
 * no data flows for the full duration - so long-running streams survive.
 */
export const STREAM_INACTIVITY_TIMEOUT_MS = 1800000;

/**
 * Server keep-alive timeout in milliseconds (65 seconds).
 * Controls how long to keep idle connections open.
 * Set higher than typical client timeout (60s) to prevent premature disconnects.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65000;

/**
 * Headers timeout in milliseconds (60 seconds).
 * How long to wait for HTTP headers before timing out.
 */
export const HEADERS_TIMEOUT_MS = 60000;

/**
 * Model cache TTL in milliseconds (60 seconds).
 * Controls how long cached models are valid before refresh.
 */
export const MODEL_CACHE_TTL_MS = 60000;

// CORS origin handling has moved to security.ts (normalizeOrigin, isOriginAllowed,
// buildCorsHeaders) as part of the security hardening sprint. isLocalhostOrigin,
// getCorsHeaders, and CORS_HEADERS were removed from here.

// ============================================================================
// Tool/Function Calling Types
// @see docs/features/tool-calling/design.md
// ============================================================================

/**
 * OpenAI-compatible tool definition.
 */
export interface Tool {
    type: 'function';
    function: ToolFunction;
}

/**
 * Function definition within a tool.
 */
export interface ToolFunction {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>; // JSON Schema
}

/**
 * Tool call made by the model.
 */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

/**
 * Tool call delta for streaming responses.
 */
export interface ToolCallDelta {
    index: number;
    id?: string;           // Only in first chunk for this tool call
    type?: 'function';     // Only in first chunk
    function?: {
        name?: string;     // Only in first chunk
        arguments?: string; // Streamed incrementally
    };
}

/**
 * Tool information returned by GET /v1/tools.
 */
export interface ToolInfo {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    tags?: readonly string[] | string[];
}

/**
 * Response format for GET /v1/tools endpoint.
 */
export interface ToolsResponse {
    object: 'list';
    data: ToolInfo[];
}

// ============================================================================
// Chat Message Types
// ============================================================================

/**
 * OpenAI content part (multimodal format).
 * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages
 */
export interface ContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string; detail?: string };
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | ContentPart[] | null;
    // For assistant messages with tool calls
    tool_calls?: ToolCall[];
    // For tool result messages
    tool_call_id?: string;
    name?: string; // Tool name for tool role messages
}

/**
 * Extracts text from message content, flattening array content parts to a string.
 * Image parts are skipped since VS Code LM API doesn't support them.
 */
export function getTextContent(content: string | ContentPart[] | null | undefined): string {
    if (content == null) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    return content
        .filter((part): part is ContentPart & { type: 'text' } => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n');
}

// ============================================================================
// Anthropic Messages API Types
// @see https://docs.anthropic.com/en/api/messages
// ============================================================================

/**
 * Anthropic content block - text or tool use/result.
 */
export type AnthropicContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] };

/**
 * Anthropic message in a conversation.
 */
export interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}

/**
 * Anthropic tool definition.
 */
export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
}

/**
 * Anthropic Messages API request.
 */
export interface AnthropicRequest {
    model?: string;
    messages: AnthropicMessage[];
    system?: string | AnthropicContentBlock[];
    max_tokens: number;
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    tools?: AnthropicTool[];
    tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
    // Proxy-specific options
    use_vscode_tools?: boolean;
    tool_execution?: 'none' | 'auto';
    max_tool_rounds?: number;
}

/**
 * Anthropic Messages API response.
 */
export interface AnthropicResponse {
    id: string;
    type: 'message';
    role: 'assistant';
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

/**
 * Anthropic streaming event types.
 */
export type AnthropicStreamEvent =
    | { type: 'message_start'; message: AnthropicResponse }
    | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
    | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
    | { type: 'content_block_stop'; index: number }
    | { type: 'message_delta'; delta: { stop_reason: string }; usage: { output_tokens: number } }
    | { type: 'message_stop' }
    | { type: 'ping' }
    | { type: 'error'; error: { type: string; message: string } };

/**
 * Tool choice options for chat completions.
 */
export type ToolChoice =
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };

export interface ChatCompletionRequest {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    // Tool calling fields
    tools?: Tool[];
    tool_choice?: ToolChoice;
    // Proxy-specific tool options
    use_vscode_tools?: boolean;      // Include all VS Code registered tools
    tool_execution?: 'none' | 'auto'; // Server-side tool execution mode
    max_tool_rounds?: number;         // Max iterations (default: 10, 0 = unlimited)
}

export interface OpenAIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string | null;
            tool_calls?: ToolCall[];
        };
        finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface StreamChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        delta: {
            role?: string;
            content?: string;
            tool_calls?: ToolCallDelta[];
        };
        finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
    }[];
}

export interface ModelInfo {
    id: string;
    name: string;
    family: string;
    vendor: string;
    maxInputTokens: number;
}

export interface SettingsInfo {
    port: number;
    autoStart: boolean;
    defaultModel: string;
    logRequestsToUI: boolean;
}

export interface RequestLogEntry {
    id: string;
    timestamp: string;
    method: string;
    endpoint: string;
    model: string;
    messageCount: number;
    inputChars: number;
    outputChars: number;
    stream: boolean;
    durationMs: number;
    status: 'success' | 'error';
    errorMessage?: string;
}

export interface ModelStats {
    total: number;
    success: number;
    error: number;
    inputChars: number;
    outputChars: number;
    durationMsSum: number;
}

export interface StatsCounters {
    total: number;
    success: number;
    error: number;
    openai: number;
    anthropic: number;
    inputChars: number;
    outputChars: number;
    durationMsSum: number;
    byModel: Record<string, ModelStats>;
}

export function emptyModelStats(): ModelStats {
    return {
        total: 0,
        success: 0,
        error: 0,
        inputChars: 0,
        outputChars: 0,
        durationMsSum: 0
    };
}

export function emptyStats(): StatsCounters {
    return {
        total: 0,
        success: 0,
        error: 0,
        openai: 0,
        anthropic: 0,
        inputChars: 0,
        outputChars: 0,
        durationMsSum: 0,
        byModel: {}
    };
}

export function applyStatsEntry(stats: StatsCounters, entry: RequestLogEntry): void {
    stats.total += 1;
    if (entry.status === 'success') {
        stats.success += 1;
    } else {
        stats.error += 1;
    }
    if (entry.endpoint.includes('messages')) {
        stats.anthropic += 1;
    } else {
        stats.openai += 1;
    }
    stats.inputChars += entry.inputChars;
    stats.outputChars += entry.outputChars;
    stats.durationMsSum += entry.durationMs;

    const modelKey = entry.model || 'unknown';
    if (!stats.byModel) {
        stats.byModel = {};
    }
    const m = stats.byModel[modelKey] ?? (stats.byModel[modelKey] = emptyModelStats());
    m.total += 1;
    if (entry.status === 'success') {
        m.success += 1;
    } else {
        m.error += 1;
    }
    m.inputChars += entry.inputChars;
    m.outputChars += entry.outputChars;
    m.durationMsSum += entry.durationMs;
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Generates a unique ID for chat completions.
 */
export function generateId(): string {
    return 'chatcmpl-' + Math.random().toString(36).substring(2, 15);
}

/**
 * Estimates token count from character count.
 * Uses rough estimate of ~4 characters per token.
 */
export function estimateTokens(charCount: number): number {
    return Math.ceil(charCount / 4);
}

/**
 * Calculates context size metrics from messages.
 */
export function calculateContextSize(messages: ChatMessage[]): {
    messageCount: number;
    totalChars: number;
    estimatedTokens: number;
} {
    const messageCount = messages.length;
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const estimatedTokens = estimateTokens(totalChars);
    return { messageCount, totalChars, estimatedTokens };
}

/**
 * Key identifiers used for model matching.
 */
export const MODEL_KEY_IDENTIFIERS = ['claude', 'gpt', 'opus', 'sonnet', 'haiku', 'o1', 'o3', 'gemini'];

/**
 * Model matching score constants.
 *
 * Scoring priorities (highest to lowest):
 * 1. Exact ID/family match (handled before scoring)
 * 2. Version match (+50)
 * 3. Key identifier match (+10 per match)
 * 4. Family containment (+5)
 *
 * Penalties:
 * - Wrong version (-20)
 * - Key identifier mismatch (-1)
 */
export const MODEL_SCORE = {
    /** Bonus when requested version matches model version */
    VERSION_MATCH: 50,
    /** Penalty when model has different version than requested */
    VERSION_MISMATCH: -20,
    /** Bonus per matching key identifier (claude, gpt, etc.) */
    KEY_IDENTIFIER_MATCH: 10,
    /** Penalty when request has key that model doesn't or vice versa */
    KEY_IDENTIFIER_MISMATCH: -1,
    /** Bonus when request contains model family name */
    FAMILY_CONTAINMENT: 5,
    /** Minimum family length to award containment bonus */
    MIN_FAMILY_LENGTH: 3
} as const;

/**
 * Extracts version from a model request string.
 * E.g., "claude-4-5" -> "4.5", "gpt-4.1" -> "4.1"
 */
export function extractVersion(requested: string): string | null {
    const versionMatch = requested.match(/(\d+)[.-](\d+)/);
    return versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : null;
}

/**
 * Scores a model against a requested model string.
 * Higher scores indicate better matches.
 *
 * @see MODEL_SCORE for scoring constants and priorities
 */
export function scoreModelMatch(
    requested: string,
    model: { id: string; name: string; family: string }
): number {
    const requestedLower = requested.toLowerCase();
    const family = model.family.toLowerCase();
    const name = model.name.toLowerCase();
    const id = model.id.toLowerCase();
    let score = 0;

    // Count how many key identifiers match between request and model
    for (const key of MODEL_KEY_IDENTIFIERS) {
        const requestHasKey = requestedLower.includes(key);
        const modelHasKey = family.includes(key) || name.includes(key) || id.includes(key);

        if (requestHasKey && modelHasKey) {
            score += MODEL_SCORE.KEY_IDENTIFIER_MATCH;
        } else if (requestHasKey !== modelHasKey) {
            score += MODEL_SCORE.KEY_IDENTIFIER_MISMATCH;
        }
    }

    // Version matching - high priority
    const requestedVersion = extractVersion(requestedLower);
    if (requestedVersion) {
        const modelStr = `${family} ${name} ${id}`;
        if (modelStr.includes(requestedVersion)) {
            score += MODEL_SCORE.VERSION_MATCH;
        } else {
            // Check if model has a different version - penalize
            const modelVersionMatch = modelStr.match(/(\d+)\.(\d+)/);
            if (modelVersionMatch) {
                score += MODEL_SCORE.VERSION_MISMATCH;
            }
        }
    }

    // Bonus for family containment
    if (requestedLower.includes(family) && family.length >= MODEL_SCORE.MIN_FAMILY_LENGTH) {
        score += MODEL_SCORE.FAMILY_CONTAINMENT;
    }

    return score;
}

/**
 * Finds the best matching model from a list based on the requested model string.
 */
export function findBestModel<T extends { id: string; name: string; family: string }>(
    requestedModel: string | undefined,
    models: T[],
    defaultModel?: string
): T | undefined {
    if (models.length === 0) {
        return undefined;
    }

    // Use default if no model specified
    const requested = requestedModel || defaultModel;

    if (!requested || requested === '') {
        return models[0];
    }

    const requestedLower = requested.toLowerCase();

    // Try exact match first (case-insensitive)
    let model = models.find(m => m.id.toLowerCase() === requestedLower);
    if (model) return model;

    // Try exact family match
    model = models.find(m => m.family.toLowerCase() === requestedLower);
    if (model) return model;

    // Score-based matching - find the best match
    let bestMatch: T | undefined;
    let bestScore = 0;

    for (const m of models) {
        const score = scoreModelMatch(requested, m);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = m;
        }
    }

    if (bestMatch && bestScore > 0) {
        return bestMatch;
    }

    // Return first available model
    return models[0];
}

/**
 * Creates an OpenAI-format response object.
 */
export function createOpenAIResponse(
    id: string,
    model: string,
    content: string,
    created?: number
): OpenAIResponse {
    return {
        id,
        object: 'chat.completion',
        created: created ?? Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content
            },
            finish_reason: 'stop' as const
        }],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    };
}

/**
 * Creates a streaming chunk object.
 */
export function createStreamChunk(
    id: string,
    model: string,
    content?: string,
    role?: string,
    finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null = null,
    created?: number
): StreamChunk {
    return {
        id,
        object: 'chat.completion.chunk',
        created: created ?? Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            delta: {
                ...(role ? { role } : {}),
                ...(content !== undefined ? { content } : {})
            },
            finish_reason: finishReason
        }]
    };
}

/**
 * Creates an error response object in OpenAI format.
 */
export function createErrorResponse(
    message: string,
    type: string,
    code: number
): { error: { message: string; type: string; code: number } } {
    return {
        error: {
            message,
            type,
            code
        }
    };
}

/**
 * Parses a JSON request body safely.
 */
export function parseRequestBody(body: string): ChatCompletionRequest | null {
    try {
        return JSON.parse(body) as ChatCompletionRequest;
    } catch {
        return null;
    }
}

/**
 * Validates a chat completion request.
 */
export function validateRequest(request: ChatCompletionRequest): string | null {
    if (!request.messages || !Array.isArray(request.messages)) {
        return 'messages is required and must be an array';
    }
    if (request.messages.length === 0) {
        return 'messages array cannot be empty';
    }
    for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (!msg.role || !['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
            return `messages[${i}].role must be one of: system, user, assistant, tool`;
        }
        // content can be null, a string, or an array of content parts
        if (msg.content !== null && typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
            return `messages[${i}].content must be a string, array of content parts, or null`;
        }
        if (Array.isArray(msg.content)) {
            for (let j = 0; j < msg.content.length; j++) {
                const part = msg.content[j];
                if (!part.type || !['text', 'image_url'].includes(part.type)) {
                    return `messages[${i}].content[${j}].type must be 'text' or 'image_url'`;
                }
            }
        }
        // Validate tool role messages
        if (msg.role === 'tool') {
            if (!msg.tool_call_id || typeof msg.tool_call_id !== 'string') {
                return `messages[${i}] with role 'tool' must have tool_call_id`;
            }
        }
        // Validate assistant messages with tool_calls
        if (msg.role === 'assistant' && msg.tool_calls) {
            if (!Array.isArray(msg.tool_calls)) {
                return `messages[${i}].tool_calls must be an array`;
            }
            for (let j = 0; j < msg.tool_calls.length; j++) {
                const tc = msg.tool_calls[j];
                if (!tc.id || typeof tc.id !== 'string') {
                    return `messages[${i}].tool_calls[${j}].id must be a string`;
                }
                if (tc.type !== 'function') {
                    return `messages[${i}].tool_calls[${j}].type must be 'function'`;
                }
                if (!tc.function?.name) {
                    return `messages[${i}].tool_calls[${j}].function.name is required`;
                }
            }
        }
    }
    // Validate tools array if present
    if (request.tools !== undefined) {
        const toolsError = validateTools(request.tools);
        if (toolsError) {
            return toolsError;
        }
    }
    return null;
}

/**
 * Formats a timestamp for logging.
 */
export function formatTimestamp(): string {
    return new Date().toLocaleTimeString();
}

/**
 * Formats a log message with timestamp.
 */
export function formatLogMessage(message: string): string {
    return `[${formatTimestamp()}] ${message}`;
}

/**
 * Formats an error log message with timestamp.
 */
export function formatErrorMessage(message: string, error?: unknown): string {
    const errorDetails = error instanceof Error ? error.message : String(error ?? '');
    return errorDetails
        ? `[${formatTimestamp()}] ERROR: ${message} - ${errorDetails}`
        : `[${formatTimestamp()}] ERROR: ${message}`;
}

// ============================================================================
// Tool/Function Calling Helper Functions
// @see docs/features/tool-calling/design.md
// ============================================================================

/**
 * Default maximum tool execution rounds for auto-execute mode.
 */
export const DEFAULT_MAX_TOOL_ROUNDS = 10;

/**
 * Generates a unique tool call ID.
 * Format: call_<random_string>
 */
export function generateToolCallId(): string {
    return 'call_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Validates a tools array from a request.
 * Returns null if valid, error message if invalid.
 */
export function validateTools(tools: unknown): string | null {
    if (!Array.isArray(tools)) {
        return 'tools must be an array';
    }

    for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        if (!tool || typeof tool !== 'object') {
            return `tools[${i}] must be an object`;
        }
        if (tool.type !== 'function') {
            return `tools[${i}].type must be 'function'`;
        }
        if (!tool.function || typeof tool.function !== 'object') {
            return `tools[${i}].function must be an object`;
        }
        if (typeof tool.function.name !== 'string' || tool.function.name.length === 0) {
            return `tools[${i}].function.name must be a non-empty string`;
        }
        // parameters is optional, but if provided must be an object (JSON Schema)
        if (tool.function.parameters !== undefined && typeof tool.function.parameters !== 'object') {
            return `tools[${i}].function.parameters must be an object (JSON Schema)`;
        }
    }

    return null;
}

/**
 * Validates a tool role message.
 * Returns null if valid, error message if invalid.
 */
export function validateToolMessage(message: ChatMessage): string | null {
    if (message.role === 'tool') {
        if (!message.tool_call_id || typeof message.tool_call_id !== 'string') {
            return 'tool role message must have tool_call_id';
        }
    }
    return null;
}

/**
 * Creates an OpenAI-format response object with tool calls.
 */
export function createOpenAIResponseWithTools(
    id: string,
    model: string,
    content: string | null,
    toolCalls: ToolCall[],
    created?: number
): OpenAIResponse {
    return {
        id,
        object: 'chat.completion',
        created: created ?? Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            },
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        }],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    };
}

/**
 * Creates a streaming chunk with tool call deltas.
 */
export function createStreamChunkWithTools(
    id: string,
    model: string,
    toolCallDeltas: ToolCallDelta[],
    finishReason: 'stop' | 'tool_calls' | null = null,
    created?: number
): StreamChunk {
    return {
        id,
        object: 'chat.completion.chunk',
        created: created ?? Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            delta: {
                tool_calls: toolCallDeltas.length > 0 ? toolCallDeltas : undefined
            },
            finish_reason: finishReason
        }]
    };
}

/**
 * Filters tools by tags (all tags must match).
 */
export function filterToolsByTags(tools: ToolInfo[], tags: string[]): ToolInfo[] {
    if (tags.length === 0) return tools;
    return tools.filter(tool =>
        tags.every(tag => tool.tags?.includes(tag))
    );
}

/**
 * Filters tools by name pattern with wildcards.
 * Supports * as wildcard (e.g., "get_*" matches "get_weather").
 */
export function filterToolsByName(tools: ToolInfo[], pattern: string): ToolInfo[] {
    if (!pattern) return tools;
    // Convert wildcard pattern to regex
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except *
        .replace(/\*/g, '.*'); // Convert * to .*
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return tools.filter(tool => regex.test(tool.name));
}

// ============================================================================
// Anthropic Messages API Helper Functions
// ============================================================================

/**
 * Generates a unique message ID for Anthropic responses.
 */
export function generateAnthropicId(): string {
    return 'msg_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 6);
}

/**
 * Parses an Anthropic request body safely.
 */
export function parseAnthropicRequestBody(body: string): AnthropicRequest | null {
    try {
        return JSON.parse(body) as AnthropicRequest;
    } catch {
        return null;
    }
}

/**
 * Validates an Anthropic Messages API request.
 */
export function validateAnthropicRequest(request: AnthropicRequest): string | null {
    if (!request.messages || !Array.isArray(request.messages)) {
        return 'messages is required and must be an array';
    }
    if (request.messages.length === 0) {
        return 'messages array cannot be empty';
    }
    if (request.max_tokens === undefined || request.max_tokens === null) {
        return 'max_tokens is required';
    }
    if (typeof request.max_tokens !== 'number' || request.max_tokens < 1) {
        return 'max_tokens must be a positive integer';
    }
    for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (!msg.role || !['user', 'assistant'].includes(msg.role)) {
            return `messages[${i}].role must be one of: user, assistant`;
        }
        // content can be string or array of content blocks
        if (msg.content === null || msg.content === undefined) {
            return `messages[${i}].content is required`;
        }
    }
    // Validate tools if present
    if (request.tools !== undefined) {
        if (!Array.isArray(request.tools)) {
            return 'tools must be an array';
        }
        for (let i = 0; i < request.tools.length; i++) {
            const tool = request.tools[i];
            if (!tool.name || typeof tool.name !== 'string') {
                return `tools[${i}].name must be a non-empty string`;
            }
            if (tool.input_schema !== undefined && typeof tool.input_schema !== 'object') {
                return `tools[${i}].input_schema must be an object`;
            }
        }
    }
    return null;
}

/**
 * Converts Anthropic messages to the internal ChatMessage format.
 * Extracts system message from top-level field.
 */
export function convertAnthropicToInternal(request: AnthropicRequest): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // Convert system to a user message (VS Code LM API has no system role)
    if (request.system) {
        const systemText = typeof request.system === 'string'
            ? request.system
            : request.system
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map(b => b.text)
                .join('\n');
        if (systemText) {
            messages.push({ role: 'system', content: systemText });
        }
    }

    // Convert each Anthropic message
    for (const msg of request.messages) {
        if (typeof msg.content === 'string') {
            messages.push({
                role: msg.role,
                content: msg.content
            });
        } else if (Array.isArray(msg.content)) {
            if (msg.role === 'assistant') {
                // Check for tool_use blocks
                const textParts = msg.content
                    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                    .map(b => b.text)
                    .join('');
                const toolUseParts = msg.content
                    .filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use');

                if (toolUseParts.length > 0) {
                    messages.push({
                        role: 'assistant',
                        content: textParts || null,
                        tool_calls: toolUseParts.map(t => ({
                            id: t.id,
                            type: 'function' as const,
                            function: {
                                name: t.name,
                                arguments: JSON.stringify(t.input)
                            }
                        }))
                    });
                } else {
                    messages.push({
                        role: 'assistant',
                        content: textParts
                    });
                }
            } else {
                // User message - may contain text and tool_result blocks
                const toolResults = msg.content
                    .filter((b): b is { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] } => b.type === 'tool_result');
                const textParts = msg.content
                    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                    .map(b => b.text)
                    .join('');

                if (toolResults.length > 0) {
                    // Add tool result messages
                    for (const tr of toolResults) {
                        const resultContent = typeof tr.content === 'string'
                            ? tr.content
                            : (tr.content || [])
                                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                                .map(b => b.text)
                                .join('');
                        messages.push({
                            role: 'tool',
                            content: resultContent,
                            tool_call_id: tr.tool_use_id
                        });
                    }
                    // If there's also text, add as user message
                    if (textParts) {
                        messages.push({ role: 'user', content: textParts });
                    }
                } else {
                    messages.push({
                        role: 'user',
                        content: textParts
                    });
                }
            }
        }
    }

    return messages;
}

/**
 * Converts Anthropic tool definitions to OpenAI tool format (internal).
 */
export function convertAnthropicToolsToInternal(tools: AnthropicTool[]): Tool[] {
    return tools.map(t => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema
        }
    }));
}

/**
 * Creates an Anthropic Messages API response.
 */
export function createAnthropicResponse(
    id: string,
    model: string,
    content: string,
    toolCalls?: ToolCall[],
    _created?: number
): AnthropicResponse {
    const contentBlocks: AnthropicContentBlock[] = [];

    if (content) {
        contentBlocks.push({ type: 'text', text: content });
    }

    if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
            let input: Record<string, unknown> = {};
            try {
                input = JSON.parse(tc.function.arguments);
            } catch {
                // keep empty
            }
            contentBlocks.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input
            });
        }
    }

    const hasToolUse = toolCalls && toolCalls.length > 0;

    return {
        id,
        type: 'message',
        role: 'assistant',
        content: contentBlocks,
        model,
        stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: {
            input_tokens: 0,
            output_tokens: 0
        }
    };
}

/**
 * Creates an Anthropic error response.
 */
export function createAnthropicErrorResponse(
    message: string,
    type: string
): { type: 'error'; error: { type: string; message: string } } {
    return {
        type: 'error',
        error: {
            type,
            message
        }
    };
}
