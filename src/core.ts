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
 * Request timeout in milliseconds (2 minutes).
 * Prevents connection exhaustion from slow requests.
 * Set higher for LLM responses which can take time.
 */
export const REQUEST_TIMEOUT_MS = 120000;

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

/**
 * Check if an origin is a localhost origin.
 * Allows http://localhost:* and http://127.0.0.1:*
 */
export function isLocalhostOrigin(origin: string | undefined): boolean {
    if (!origin) return true; // No origin = direct API call (curl, etc.)
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/**
 * Get CORS headers for a request.
 * Only allows localhost origins to prevent malicious websites from accessing the API.
 */
export function getCorsHeaders(origin: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
    };

    // Only set Allow-Origin for localhost origins
    if (isLocalhostOrigin(origin)) {
        headers['Access-Control-Allow-Origin'] = origin || '*';
    }
    // If not localhost origin, don't set Allow-Origin - browser will block

    return headers;
}

/**
 * CORS headers for HTTP responses (legacy - use getCorsHeaders for origin validation).
 * @deprecated Use getCorsHeaders(req.headers.origin) instead for origin validation.
 */
export const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
} as const;

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

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    // For assistant messages with tool calls
    tool_calls?: ToolCall[];
    // For tool result messages
    tool_call_id?: string;
    name?: string; // Tool name for tool role messages
}

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
    rawLogging: boolean;
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
        // content can be null for assistant messages with tool_calls
        if (msg.content !== null && typeof msg.content !== 'string') {
            return `messages[${i}].content must be a string or null`;
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
