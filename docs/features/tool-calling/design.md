# Tool/Function Calling Support - Feature Design Document

## Overview

Add OpenAI-compatible tool/function calling support to the Copilot Proxy. This enables external clients to define tools that the language model can invoke, allowing for agentic workflows and tool-augmented AI applications.

## Problem Statement

Many AI applications require tool calling capabilities:

- AI agents that need to execute actions (search, code execution, API calls)
- Retrieval-augmented generation (RAG) systems
- Agentic coding assistants
- MCP-compatible tools

The proxy currently only supports basic chat completions without tool calling. VS Code's Language Model API now supports tool calling via `LanguageModelChatRequestOptions.tools`, making this feature possible.

## Solution

Add comprehensive tool support to the proxy:

1. **GET /v1/tools** - List available VS Code tools with filtering
2. **Tool pass-through** - Accept tools in requests, return tool calls to client
3. **Auto-include VS Code tools** - Option to use all registered VS Code tools
4. **Server-side tool execution** - Optional agentic mode where proxy executes tools

### Two Operating Modes

| Mode | Use Case |
|------|----------|
| **Pass-through** (default) | Client handles tool execution loop |
| **Auto-execute** | Proxy runs tools and returns final answer |

## Architecture

```
Client Request                        Proxy                           VS Code LM API
    |                                   |                                   |
    |  POST /v1/chat/completions        |                                   |
    |  { tools: [...], messages: [...]} |                                   |
    |---------------------------------->|                                   |
    |                                   |  Convert tools to VS Code format  |
    |                                   |---------------------------------->|
    |                                   |  sendRequest(msgs, {tools}, token)|
    |                                   |---------------------------------->|
    |                                   |                                   |
    |                                   |  Response with ToolCallPart       |
    |                                   |<----------------------------------|
    |                                   |                                   |
    |  { choices: [{ message: {         |  Convert to OpenAI format         |
    |      tool_calls: [...]            |<----------------------------------|
    |    }}]}                           |                                   |
    |<----------------------------------|                                   |
    |                                   |                                   |
    |  (Client executes tool locally)   |                                   |
    |                                   |                                   |
    |  POST (with tool result message)  |                                   |
    |---------------------------------->|                                   |
    |         ...continues...           |                                   |
```

## API Design

### New Endpoint: GET /v1/tools

**Purpose**: List all available tools registered in VS Code (built-in, extension, and MCP tools).

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `tags` | string | Comma-separated tags to filter by (e.g., `tags=vscode,editor`) |
| `name` | string | Filter by name pattern with wildcards (e.g., `name=get_*`) |

**Response**:
```typescript
interface ToolsResponse {
    object: 'list';
    data: ToolInfo[];
}

interface ToolInfo {
    name: string;           // Tool name (e.g., "get_weather")
    description: string;    // Human-readable description
    inputSchema?: object;   // JSON Schema for parameters
    tags?: string[];        // Tool tags for filtering
}
```

**Example Requests**:
```bash
# List all tools
curl http://127.0.0.1:8080/v1/tools

# Filter by tags
curl "http://127.0.0.1:8080/v1/tools?tags=vscode,editor"

# Filter by name pattern
curl "http://127.0.0.1:8080/v1/tools?name=get_*"
```

**Example Response**:
```json
{
    "object": "list",
    "data": [
        {
            "name": "vscode_getOpenEditors",
            "description": "Get list of currently open editors",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "tags": ["vscode", "editor"]
        }
    ]
}
```

This endpoint reads from `vscode.lm.tools` which includes:
- Built-in VS Code tools
- Tools from installed extensions
- Tools from connected MCP servers

---

### Extended Request Format

```typescript
interface ChatCompletionRequest {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    // Tool calling fields
    tools?: Tool[];
    tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
    // NEW: Proxy-specific tool options
    use_vscode_tools?: boolean;      // Include all VS Code registered tools
    tool_execution?: 'none' | 'auto'; // Server-side tool execution mode
    max_tool_rounds?: number;         // Max iterations (default: 10, 0 = unlimited)
}

interface Tool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: JSONSchema;  // JSON Schema object
    };
}
```

### Proxy-Specific Options

#### use_vscode_tools

When `true`, automatically includes all tools from `vscode.lm.tools` in the request. These are merged with any custom `tools` provided.

```json
{
    "messages": [{"role": "user", "content": "List open files"}],
    "use_vscode_tools": true
}
```

#### tool_execution

Controls whether the proxy executes tools server-side or returns tool calls to the client.

| Mode | Behavior |
|------|----------|
| `"none"` (default) | Pass-through mode - return tool calls to client |
| `"auto"` | Proxy executes tools via `vscode.lm.invokeTool()` and loops until complete |

**Auto Mode Flow**:
```
Client                              Proxy                              VS Code
   |                                   |                                   |
   | POST (use_vscode_tools, auto)     |                                   |
   |---------------------------------->|                                   |
   |                                   |  sendRequest with tools           |
   |                                   |---------------------------------->|
   |                                   |  ToolCallPart response            |
   |                                   |<----------------------------------|
   |                                   |                                   |
   |                                   |  vscode.lm.invokeTool()           |
   |                                   |---------------------------------->|
   |                                   |  Tool result                      |
   |                                   |<----------------------------------|
   |                                   |                                   |
   |                                   |  sendRequest with result          |
   |                                   |---------------------------------->|
   |                                   |  (repeat until no more tools)     |
   |                                   |                                   |
   |  Final response (no tool_calls)   |                                   |
   |<----------------------------------|                                   |
```

**Example - Agentic Request**:
```json
{
    "messages": [{"role": "user", "content": "Read the package.json and tell me the version"}],
    "use_vscode_tools": true,
    "tool_execution": "auto",
    "max_tool_rounds": 5
}
```

The proxy will:
1. Include VS Code's file reading tools
2. Model requests to read package.json
3. Proxy invokes the tool, gets file contents
4. Model receives contents, generates final answer
5. Client receives final response with version info

### Extended Message Format

```typescript
interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    // For assistant messages with tool calls
    tool_calls?: ToolCall[];
    // For tool result messages
    tool_call_id?: string;
    name?: string;  // Tool name for tool role messages
}

interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;  // JSON string
    };
}
```

### Response with Tool Calls

```typescript
interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: [{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: ToolCall[];  // Present when model wants to call tools
        };
        finish_reason: 'stop' | 'tool_calls';
    }];
    usage: { ... };
}
```

### Streaming with Tool Calls

Tool calls in streaming mode are sent as deltas:

```typescript
interface StreamChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: [{
        index: number;
        delta: {
            role?: string;
            content?: string;
            tool_calls?: ToolCallDelta[];
        };
        finish_reason: string | null;
    }];
}

interface ToolCallDelta {
    index: number;
    id?: string;           // Only in first chunk for this tool call
    type?: 'function';     // Only in first chunk
    function?: {
        name?: string;     // Only in first chunk
        arguments?: string; // Streamed incrementally
    };
}
```

## Implementation Details

### Tool Conversion: OpenAI to VS Code

```typescript
function convertToVSCodeTools(tools: Tool[]): vscode.LanguageModelChatTool[] {
    return tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description || '',
        inputSchema: tool.function.parameters
    }));
}
```

### Tool Choice Mapping

| OpenAI tool_choice | VS Code toolMode |
|--------------------|------------------|
| `'none'` | Not pass tools |
| `'auto'` | Default behavior |
| `'required'` | `vscode.LanguageModelChatToolMode.Required` |
| `{ function: { name } }` | Filter to single tool |

### Response Part Handling

VS Code responses may contain multiple part types:

```typescript
for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelTextPart) {
        // Regular text content
        handleTextPart(part);
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
        // Tool call request from model
        handleToolCallPart(part);
    }
}
```

### Tool Call Part Conversion

```typescript
function convertToolCallPart(part: vscode.LanguageModelToolCallPart): ToolCall {
    return {
        id: part.callId || generateToolCallId(),
        type: 'function',
        function: {
            name: part.name,
            arguments: JSON.stringify(part.input)
        }
    };
}
```

### Tool Result Message Conversion

When client sends tool results back:

```typescript
function convertToolResultMessage(msg: ChatMessage): vscode.LanguageModelChatMessage {
    if (msg.role === 'tool') {
        // VS Code expects tool results as user messages with ToolResultPart
        return vscode.LanguageModelChatMessage.User([
            new vscode.LanguageModelToolResultPart(
                msg.tool_call_id,
                [new vscode.LanguageModelTextPart(msg.content)]
            )
        ]);
    }
    // ... existing conversion
}
```

## Configuration

No new configuration required. Tool calling is automatically enabled when tools are provided in the request.

## Error Handling

### New Error Scenarios

| Code | Type | Cause |
|------|------|-------|
| 400 | invalid_request_error | Invalid tool definition schema |
| 400 | invalid_request_error | tool_call_id missing for tool role message |
| 400 | invalid_request_error | Referenced tool_call_id not found |

### Validation Rules

1. Each tool must have `type: 'function'`
2. Each tool function must have a `name`
3. `parameters` must be valid JSON Schema if provided
4. Tool role messages must have `tool_call_id`
5. Tool role messages must reference a previous tool call

## Testing Strategy

### Manual Testing

```bash
# List available tools
curl http://127.0.0.1:8080/v1/tools

# Request with tools
curl -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is the weather in London?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }]
  }'

# Send tool result
curl -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is the weather in London?"},
      {"role": "assistant", "content": null, "tool_calls": [
        {"id": "call_123", "type": "function", "function": {"name": "get_weather", "arguments": "{\"location\":\"London\"}"}}
      ]},
      {"role": "tool", "tool_call_id": "call_123", "content": "Sunny, 22C"}
    ],
    "tools": [...]
  }'
```

### Integration Testing

- Test with Python `openai` library
- Test with LangChain tool agents
- Test with Continue.dev
- Test streaming tool calls

## Limitations

1. **No tool result caching**: Each request is independent
2. **VS Code API limitations**: Subject to what VS Code LM API supports
3. **No parallel tool calls guarantee**: Depends on model behavior
4. **Auto-execute security**: Tools run with VS Code's permissions
5. **Streaming + auto-execute**: Cannot stream intermediate tool calls in auto mode

## Future Enhancements

1. **Tool call logging**: Track tool usage in request logs with timing
2. **Tool allowlist/blocklist**: Configuration to restrict which tools can be used
3. **Tool result streaming**: Stream progress during auto-execute mode
4. **Custom tool registration**: Allow registering tools via API (not just VS Code extensions)

## Dependencies

- VS Code API `^1.90.0` with tool calling support
- No new external dependencies

## File Changes

| File | Changes |
|------|---------|
| `src/core.ts` | Add tool-related interfaces and conversion functions |
| `src/extension.ts` | Update request handler to process tools |

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2025-12-20 | Initial design |

---

**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
