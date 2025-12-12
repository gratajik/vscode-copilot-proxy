# VS Code Copilot Proxy - Feature Design Document

## Overview

VS Code Copilot Proxy is a VS Code extension that exposes VS Code's Language Model API (used by GitHub Copilot) as an OpenAI-compatible HTTP server. This enables external applications, agents, and tools to leverage Copilot's language models without direct API access or additional costs.

## Problem Statement

Many developers and tools require access to large language models for:
- AI-powered coding assistants
- Automated code generation
- Chat-based development tools
- Custom AI agents

However, direct API access to models like Claude or GPT-4 requires:
- Separate API subscriptions with usage-based costs
- API key management
- Rate limit handling

GitHub Copilot subscribers already have access to powerful language models through VS Code, but this access is locked within the VS Code extension ecosystem.

## Solution

Create a VS Code extension that:
1. Runs an HTTP server within VS Code
2. Exposes an OpenAI-compatible REST API
3. Proxies requests to VS Code's `vscode.lm` API
4. Returns responses in standard OpenAI format

This allows any OpenAI-compatible client to use Copilot models at no additional cost.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Clients                         │
│  (Python scripts, CLI tools, AI agents, web apps, etc.)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (port 8080)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Copilot Proxy Extension                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     HTTP Server                           │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌───────────┐  │  │
│  │  │ /v1/chat/       │  │ /v1/models      │  │ /health   │  │  │
│  │  │ completions     │  │                 │  │           │  │  │
│  │  └────────┬────────┘  └────────┬────────┘  └───────────┘  │  │
│  │           │                    │                          │  │
│  │           ▼                    ▼                          │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Request Handler Layer                  │  │  │
│  │  │  • Parse OpenAI format requests                     │  │  │
│  │  │  • Convert to VS Code message format                │  │  │
│  │  │  • Handle streaming vs non-streaming                │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   VS Code LM API                          │  │
│  │  • vscode.lm.selectChatModels()                          │  │
│  │  • model.sendRequest()                                    │  │
│  │  • Async iteration over response.text                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Copilot Backend                       │
│              (Claude, GPT-4, other models)                      │
└─────────────────────────────────────────────────────────────────┘
```

## API Design

### Endpoint: POST /v1/chat/completions

**Purpose**: Process chat completion requests compatible with OpenAI's API format.

**Request Format**:
```typescript
interface ChatCompletionRequest {
    model?: string;           // Model identifier (flexible matching)
    messages: ChatMessage[];  // Conversation history
    temperature?: number;     // (accepted but not forwarded to VS Code API)
    max_tokens?: number;      // (accepted but not forwarded to VS Code API)
    stream?: boolean;         // Enable streaming response
}

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
```

**Non-Streaming Response**:
```typescript
interface ChatCompletionResponse {
    id: string;              // Unique completion ID
    object: 'chat.completion';
    created: number;         // Unix timestamp
    model: string;           // Model ID used
    choices: [{
        index: 0;
        message: {
            role: 'assistant';
            content: string;
        };
        finish_reason: 'stop';
    }];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
```

**Streaming Response** (Server-Sent Events):
```typescript
interface StreamChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: [{
        index: 0;
        delta: {
            role?: string;    // Only in first chunk
            content?: string; // Content fragments
        };
        finish_reason: string | null;  // 'stop' in final chunk
    }];
}
```

### Endpoint: GET /v1/models

**Purpose**: List all available language models.

**Response**:
```typescript
interface ModelsResponse {
    object: 'list';
    data: ModelInfo[];
}

interface ModelInfo {
    id: string;           // Full model identifier
    object: 'model';
    created: number;
    owned_by: string;     // Vendor (e.g., 'copilot')
    name: string;         // Human-readable name
    family: string;       // Model family
    version: string;      // Model version
    maxInputTokens: number;
}
```

### Endpoint: GET /health

**Purpose**: Health check for monitoring.

**Response**:
```json
{
    "status": "ok",
    "models_available": 3
}
```

## Implementation Details

### Model Selection Strategy

The extension uses flexible model matching to improve usability:

```typescript
async function getModel(requestedModel?: string): Promise<Model | undefined> {
    // 1. Use default from settings if no model specified
    // 2. Try exact ID match
    // 3. Try partial match on family, name, or ID
    // 4. Fall back to first available model
}
```

This allows clients to request models using:
- Full ID: `copilot-claude-3.5-sonnet`
- Family: `claude-3.5-sonnet`
- Partial: `claude` or `sonnet`

### Message Conversion

VS Code's LM API uses a different message format than OpenAI:

```typescript
function convertToVSCodeMessages(messages: ChatMessage[]): vscode.LanguageModelChatMessage[] {
    return messages.map(msg => {
        switch (msg.role) {
            case 'system':
                // VS Code API has no system role - treat as user message
                return vscode.LanguageModelChatMessage.User(msg.content);
            case 'assistant':
                return vscode.LanguageModelChatMessage.Assistant(msg.content);
            case 'user':
            default:
                return vscode.LanguageModelChatMessage.User(msg.content);
        }
    });
}
```

### Streaming Implementation

Streaming uses Server-Sent Events (SSE) format:

```typescript
// Set headers for SSE
res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
});

// Stream chunks as they arrive
for await (const chunk of response.text) {
    res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
}

// Signal completion
res.write('data: [DONE]\n\n');
```

### CORS Handling

The server enables CORS for all origins to support browser-based clients:

```typescript
res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
});
```

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `copilotProxy.port` | number | 8080 | HTTP server port |
| `copilotProxy.autoStart` | boolean | true | Start server on VS Code launch |
| `copilotProxy.defaultModel` | string | "" | Default model when not specified |

## Extension Lifecycle

### Activation

```typescript
export function activate(context: vscode.ExtensionContext) {
    // 1. Create status bar item
    // 2. Register commands
    // 3. Subscribe to model change events
    // 4. Auto-start server if configured
}
```

### Deactivation

```typescript
export function deactivate() {
    // Clean shutdown of HTTP server
    if (server) {
        server.close();
    }
}
```

## User Interface

### Status Bar

The extension displays a status bar item showing:
- Server state (running/stopped)
- Port number when running
- Model count on hover

### Commands

| Command | Description |
|---------|-------------|
| `copilot-proxy.start` | Start the proxy server |
| `copilot-proxy.stop` | Stop the proxy server |
| `copilot-proxy.status` | Show detailed status modal |

## Error Handling

### HTTP Error Responses

All errors return JSON in OpenAI error format:

```typescript
interface ErrorResponse {
    error: {
        message: string;
        type: string;
        code: number;
    };
}
```

| Code | Type | Cause |
|------|------|-------|
| 400 | invalid_request_error | Malformed JSON or invalid request |
| 404 | not_found | Unknown endpoint |
| 500 | server_error | Model request failed |
| 503 | service_unavailable | No models available |

### Common Error Scenarios

1. **No models available**: Copilot not installed or not authenticated
2. **Port in use**: Another process using configured port
3. **Model not found**: Requested model doesn't exist

## Security Considerations

### Local-Only Access

The server binds to localhost by default, preventing external network access. For security:
- Server only accepts connections from the local machine
- No authentication required (assumes trusted local environment)
- No sensitive data logging

### Input Validation

- JSON parsing with try/catch
- Type checking on required fields
- Sanitization of model identifiers

## Limitations

1. **Token counts not available**: VS Code LM API doesn't expose token usage
2. **System role handling**: Treated as user messages (API limitation)
3. **Temperature/max_tokens**: Accepted but not forwarded to VS Code API
4. **Function calling**: Not supported by VS Code LM API
5. **Rate limits**: Subject to Copilot's rate limits

## Testing Strategy

### Manual Testing

```bash
# Health check
curl http://localhost:8080/health

# List models
curl http://localhost:8080/v1/models

# Non-streaming completion
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'

# Streaming completion
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

### Integration Testing

Test with common OpenAI clients:
- Python `openai` library
- Node.js `openai` package
- LangChain
- Continue.dev

## Future Enhancements

1. **Authentication**: Optional API key requirement
2. **Rate limiting**: Request throttling
3. **Request logging**: Optional request/response logging
4. **Metrics**: Prometheus-compatible metrics endpoint
5. **Multiple ports**: Support binding to multiple ports
6. **WebSocket support**: Alternative to SSE streaming
7. **Tool/Function calling**: When VS Code API supports it

## Dependencies

- **VS Code API**: `^1.90.0` (for `vscode.lm` API)
- **Node.js built-ins**: `http` module only
- **No external dependencies**: Pure TypeScript implementation

## File Structure

```
vscode-copilot-proxy/
├── package.json           # Extension manifest
├── tsconfig.json          # TypeScript config
├── src/
│   └── extension.ts       # Main extension code
├── out/                   # Compiled JavaScript
├── .vscode/
│   ├── launch.json        # Debug configuration
│   └── tasks.json         # Build tasks
├── docs/
│   └── features/
│       └── copilot-proxy/
│           └── design.md  # This document
└── README.md              # User documentation
```

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 0.0.1 | 2024-12 | Initial implementation |
