"use strict";
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
let server = null;
let statusBarItem;
// Cache for available models
let cachedModels = [];
async function refreshModels() {
    try {
        cachedModels = await vscode.lm.selectChatModels({});
        return cachedModels;
    }
    catch (error) {
        console.error('Failed to refresh models:', error);
        return [];
    }
}
async function getModel(requestedModel) {
    if (cachedModels.length === 0) {
        await refreshModels();
    }
    if (!requestedModel || requestedModel === '') {
        const config = vscode.workspace.getConfiguration('llmProxy');
        const defaultModel = config.get('defaultModel', '');
        requestedModel = defaultModel || undefined;
    }
    if (requestedModel) {
        // Try exact match first
        let model = cachedModels.find(m => m.id === requestedModel);
        if (model)
            return model;
        // Try matching by family or name
        model = cachedModels.find(m => m.family.toLowerCase().includes(requestedModel.toLowerCase()) ||
            m.name.toLowerCase().includes(requestedModel.toLowerCase()) ||
            m.id.toLowerCase().includes(requestedModel.toLowerCase()));
        if (model)
            return model;
    }
    // Return first available model
    return cachedModels[0];
}
function convertToVSCodeMessages(messages) {
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
function generateId() {
    return 'chatcmpl-' + Math.random().toString(36).substring(2, 15);
}
async function handleChatCompletion(req, res) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    req.on('end', async () => {
        try {
            const request = JSON.parse(body);
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
            const options = {};
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
                    const response = await model.sendRequest(vsCodeMessages, options);
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
                    // Stream content chunks
                    for await (const chunk of response.text) {
                        const streamChunk = {
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
                    const finalChunk = {
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
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
                    res.end();
                }
            }
            else {
                // Non-streaming response
                try {
                    const response = await model.sendRequest(vsCodeMessages, options);
                    let content = '';
                    for await (const chunk of response.text) {
                        content += chunk;
                    }
                    const openAIResponse = {
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
                            prompt_tokens: 0, // VS Code API doesn't expose token counts
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify(openAIResponse));
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: {
                            message: errorMessage,
                            type: 'server_error',
                            code: 500
                        }
                    }));
                }
            }
        }
        catch (error) {
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
async function handleModels(res) {
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
function handleHealth(res) {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
        status: 'ok',
        models_available: cachedModels.length
    }));
}
function createServer(port) {
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
        console.log(`[LLM Proxy] ${req.method} ${url}`);
        if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
            await handleChatCompletion(req, res);
        }
        else if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
            await handleModels(res);
        }
        else if (req.method === 'GET' && (url === '/health' || url === '/')) {
            handleHealth(res);
        }
        else {
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
async function startServer() {
    if (server) {
        vscode.window.showInformationMessage('LLM Proxy server is already running');
        return;
    }
    const config = vscode.workspace.getConfiguration('llmProxy');
    const port = config.get('port', 8080);
    // Refresh models before starting
    await refreshModels();
    server = createServer(port);
    server.listen(port, () => {
        console.log(`[LLM Proxy] Server started on port ${port}`);
        vscode.window.showInformationMessage(`LLM Proxy server started on port ${port}`);
        updateStatusBar(port);
    });
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            vscode.window.showErrorMessage(`Port ${port} is already in use. Change the port in settings.`);
        }
        else {
            vscode.window.showErrorMessage(`Failed to start server: ${error.message}`);
        }
        server = null;
        updateStatusBar();
    });
}
function stopServer() {
    if (server) {
        server.close(() => {
            console.log('[LLM Proxy] Server stopped');
            vscode.window.showInformationMessage('LLM Proxy server stopped');
        });
        server = null;
        updateStatusBar();
    }
    else {
        vscode.window.showInformationMessage('LLM Proxy server is not running');
    }
}
function updateStatusBar(port) {
    if (port) {
        statusBarItem.text = `$(radio-tower) LLM Proxy: ${port}`;
        statusBarItem.tooltip = `LLM Proxy running on port ${port}\n${cachedModels.length} model(s) available\nClick to show status`;
    }
    else {
        statusBarItem.text = `$(circle-slash) LLM Proxy: Off`;
        statusBarItem.tooltip = 'LLM Proxy is not running\nClick to show status';
    }
}
async function showStatus() {
    await refreshModels();
    const config = vscode.workspace.getConfiguration('llmProxy');
    const port = config.get('port', 8080);
    const isRunning = server !== null;
    let message = `LLM Proxy Status\n\n`;
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
    const result = await vscode.window.showInformationMessage(message, { modal: true }, action);
    if (result === 'Start Server') {
        await startServer();
    }
    else if (result === 'Stop Server') {
        stopServer();
    }
}
function activate(context) {
    console.log('[LLM Proxy] Extension activating...');
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'llm-proxy.status';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('llm-proxy.start', startServer), vscode.commands.registerCommand('llm-proxy.stop', stopServer), vscode.commands.registerCommand('llm-proxy.status', showStatus));
    // Listen for model changes
    context.subscriptions.push(vscode.lm.onDidChangeChatModels(() => {
        console.log('[LLM Proxy] Chat models changed, refreshing...');
        refreshModels();
    }));
    // Auto-start if configured
    const config = vscode.workspace.getConfiguration('llmProxy');
    if (config.get('autoStart', true)) {
        startServer();
    }
    else {
        updateStatusBar();
    }
    console.log('[LLM Proxy] Extension activated');
}
function deactivate() {
    if (server) {
        server.close();
        server = null;
    }
    console.log('[LLM Proxy] Extension deactivated');
}
//# sourceMappingURL=extension.js.map