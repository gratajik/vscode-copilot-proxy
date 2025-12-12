import * as vscode from 'vscode';
import * as http from 'http';

let server: http.Server | null = null;
let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function log(message: string): void {
    console.log(`[Copilot Proxy] ${message}`);
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
        log(`Failed to refresh models: ${error}`);
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

            if (!model) {
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
                    for await (const chunk of response.text) {
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
                } catch (error) {
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

    server.listen(port, () => {
        log(`Server started on port ${port}`);
        vscode.window.showInformationMessage(`Copilot Proxy server started on port ${port}`);
        updateStatusBar(port);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            vscode.window.showErrorMessage(`Port ${port} is already in use. Change the port in settings.`);
        } else {
            vscode.window.showErrorMessage(`Failed to start server: ${error.message}`);
        }
        server = null;
        updateStatusBar();
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

async function showStatus(): Promise<void> {
    await refreshModels();

    const config = vscode.workspace.getConfiguration('copilotProxy');
    const port = config.get<number>('port', 8080);
    const isRunning = server !== null;

    let message = `Copilot Proxy Status\n\n`;
    message += `Server: ${isRunning ? `Running on port ${port}` : 'Stopped'}\n`;
    message += `Available Models: ${cachedModels.length}\n\n`;

    if (cachedModels.length > 0) {
        message += `Models:\n`;
        for (const model of cachedModels) {
            message += `  - ${model.name} (${model.id})\n`;
            message += `    Family: ${model.family}, Vendor: ${model.vendor}\n`;
            message += `    Max Input Tokens: ${model.maxInputTokens}\n`;
        }
    }

    if (isRunning) {
        message += `\nEndpoints:\n`;
        message += `  POST http://localhost:${port}/v1/chat/completions\n`;
        message += `  GET  http://localhost:${port}/v1/models\n`;
        message += `  GET  http://localhost:${port}/health\n`;
    }

    const action = isRunning ? 'Stop Server' : 'Start Server';
    const result = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        action
    );

    if (result === 'Start Server') {
        await startServer();
    } else if (result === 'Stop Server') {
        stopServer();
    }
}

export function activate(context: vscode.ExtensionContext): void {
    log('Extension activating...');

    // Create output channel
    outputChannel = vscode.window.createOutputChannel('Copilot Proxy');
    context.subscriptions.push(outputChannel);

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
    log('Extension deactivated');
}
