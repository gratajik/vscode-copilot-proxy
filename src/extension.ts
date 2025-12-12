import * as vscode from 'vscode';
import * as http from 'http';

let server: http.Server | null = null;
let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let statusPanel: vscode.WebviewPanel | undefined;

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

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface ChatCompletionRequest {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
}

interface OpenAIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

interface StreamChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        delta: {
            role?: string;
            content?: string;
        };
        finish_reason: string | null;
    }[];
}

// Cache for available models
let cachedModels: vscode.LanguageModelChat[] = [];

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

    if (!requestedModel || requestedModel === '') {
        const config = vscode.workspace.getConfiguration('copilotProxy');
        const defaultModel = config.get<string>('defaultModel', '');
        requestedModel = defaultModel || undefined;
    }

    if (requestedModel) {
        // Try exact match first
        let model = cachedModels.find(m => m.id === requestedModel);
        if (model) return model;

        // Try matching by family or name
        model = cachedModels.find(m =>
            m.family.toLowerCase().includes(requestedModel!.toLowerCase()) ||
            m.name.toLowerCase().includes(requestedModel!.toLowerCase()) ||
            m.id.toLowerCase().includes(requestedModel!.toLowerCase())
        );
        if (model) return model;
    }

    // Return first available model
    return cachedModels[0];
}

function convertToVSCodeMessages(messages: ChatMessage[]): vscode.LanguageModelChatMessage[] {
    return messages.map(msg => {
        switch (msg.role) {
            case 'system':
                // VS Code LM API doesn't have a system role, prepend to first user message or use as user
                return vscode.LanguageModelChatMessage.User(msg.content);
            case 'assistant':
                return vscode.LanguageModelChatMessage.Assistant(msg.content);
            case 'user':
            default:
                return vscode.LanguageModelChatMessage.User(msg.content);
        }
    });
}

function generateId(): string {
    return 'chatcmpl-' + Math.random().toString(36).substring(2, 15);
}

async function handleChatCompletion(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            const request: ChatCompletionRequest = JSON.parse(body);
            const model = await getModel(request.model);

            // Calculate context size
            const messageCount = request.messages.length;
            const totalChars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
            const estimatedTokens = Math.ceil(totalChars / 4); // rough estimate: ~4 chars per token

            log(`Request: ${messageCount} messages, ~${totalChars} chars (~${estimatedTokens} tokens), model: ${request.model || 'default'}, stream: ${request.stream ?? false}`);

            if (!model) {
                logError('No language models available');
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: 'No language models available. Make sure GitHub Copilot is installed and authenticated.',
                        type: 'service_unavailable',
                        code: 503
                    }
                }));
                return;
            }

            log(`Using model: ${model.name} (${model.id}), max input: ${model.maxInputTokens} tokens`);

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
                    'Access-Control-Allow-Origin': '*'
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
                    for await (const chunk of response.text) {
                        responseChars += chunk.length;
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
                } catch (error) {
                    logError('Streaming request failed', error);
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
                    res.end();
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
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify(openAIResponse));
                } catch (error) {
                    logError('Non-streaming request failed', error);
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: {
                            message: errorMessage,
                            type: 'server_error',
                            code: 500
                        }
                    }));
                } finally {
                    clearTimeout(timeoutId);
                    cancellationSource.dispose();
                }
            }
        } catch (error) {
            logError('Invalid request', error);
            const errorMessage = error instanceof Error ? error.message : 'Invalid JSON';
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: errorMessage,
                    type: 'invalid_request_error',
                    code: 400
                }
            }));
        }
    });
}

async function handleModels(res: http.ServerResponse): Promise<void> {
    await refreshModels();

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
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
        object: 'list',
        data: models
    }));
}

function handleHealth(res: http.ServerResponse): void {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
        status: 'ok',
        models_available: cachedModels.length
    }));
}

function createServer(port: number): http.Server {
    return http.createServer(async (req, res) => {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400'
            });
            res.end();
            return;
        }

        const url = req.url || '';

        log(`${req.method} ${url}`);

        if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
            await handleChatCompletion(req, res);
        } else if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
            await handleModels(res);
        } else if (req.method === 'GET' && (url === '/health' || url === '/')) {
            handleHealth(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: {
                    message: `Unknown endpoint: ${req.method} ${url}`,
                    type: 'not_found',
                    code: 404
                }
            }));
        }
    });
}

async function startServer(): Promise<void> {
    if (server) {
        vscode.window.showInformationMessage('Copilot Proxy server is already running');
        return;
    }

    const config = vscode.workspace.getConfiguration('copilotProxy');
    const port = config.get<number>('port', 8080);

    // Refresh models before starting
    refreshModels(); // Non-blocking

    server = createServer(port);

    server.listen(port, async () => {
        log(`Server started on port ${port}`);
        log(`Endpoint: http://localhost:${port}/v1/chat/completions`);

        // Log available models after server starts
        const models = await refreshModels();
        for (const m of models) {
            log(`  Model: ${m.name} (${m.id}) - max ${m.maxInputTokens} tokens`);
        }

        vscode.window.showInformationMessage(`Copilot Proxy server started on port ${port}`);
        updateStatusBar(port);
        updateStatusPanel();
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            logError(`Port ${port} is already in use`);
            vscode.window.showErrorMessage(`Port ${port} is already in use. Change the port in settings.`);
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

interface ModelInfo {
    id: string;
    name: string;
    family: string;
    vendor: string;
    maxInputTokens: number;
}

function getWebviewContent(isRunning: boolean, port: number, models: ModelInfo[]): string {
    const statusColor = isRunning ? '#4caf50' : '#9e9e9e';
    const statusText = isRunning ? `Running on port ${port}` : 'Stopped';
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
                    <code>http://localhost:${port}/v1/chat/completions</code>
                    <button class="copy-btn" data-url="http://localhost:${port}/v1/chat/completions" title="Copy URL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <code>http://localhost:${port}/v1/models</code>
                    <button class="copy-btn" data-url="http://localhost:${port}/v1/models" title="Copy URL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>
                    <code>http://localhost:${port}/health</code>
                    <button class="copy-btn" data-url="http://localhost:${port}/health" title="Copy URL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    ` : '';

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
        }
        .left-column {
            flex: 0 0 280px;
            min-width: 0;
        }
        .right-column {
            flex: 1;
            min-width: 0;
        }
        .status-row {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 24px;
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
        .section {
            margin-bottom: 24px;
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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="title">Copilot Proxy</span>
        </div>

        <div class="main-layout">
            <div class="left-column">
                <div class="section">
                    <div class="section-header">Models (${models.length})</div>
                    ${models.length > 0 ? modelCards : '<div class="empty-state">No models available</div>'}
                </div>
            </div>

            <div class="right-column">
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
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('actionBtn').addEventListener('click', () => {
            vscode.postMessage({ command: '${buttonCommand}' });
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

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function showStatus(): Promise<void> {
    await refreshModels();

    const config = vscode.workspace.getConfiguration('copilotProxy');
    const port = config.get<number>('port', 8080);
    const isRunning = server !== null;

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
    const isRunning = server !== null;

    const models: ModelInfo[] = cachedModels.map(m => ({
        id: m.id,
        name: m.name,
        family: m.family,
        vendor: m.vendor,
        maxInputTokens: m.maxInputTokens
    }));

    statusPanel.webview.html = getWebviewContent(isRunning, port, models);
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
    if (config.get<boolean>('autoStart', true)) {
        startServer();
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
