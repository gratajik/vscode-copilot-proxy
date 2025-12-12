# Copilot Proxy

> **Turn your GitHub Copilot subscription into an OpenAI-compatible API** — Use any Copilot model with your favorite AI tools, frameworks, and applications without leaving VS Code.

<p align="center">
  <img src="images/Copilot%20Proxy.png" alt="Copilot Proxy" width="600">
</p>

## About

Copilot Proxy is a VS Code extension that exposes GitHub Copilot's language models through a local OpenAI-compatible API server. This lets you leverage your existing Copilot subscription to power external applications, scripts, and tools — no additional API costs, just your Copilot subscription.

Perfect for developers who want to use Copilot's models in custom workflows, automation scripts, or with tools that expect an OpenAI-compatible endpoint.

## Features

- **OpenAI-compatible API**: Exposes endpoints that work with any OpenAI-compatible client
- **All Copilot Models**: Access any model available through your GitHub Copilot subscription
- **Streaming Support**: Full support for streaming responses
- **Auto-start**: Optionally starts automatically when VS Code opens
- **Status Bar**: Shows server status and available models

## Prerequisites

1. **GitHub Copilot Subscription** - Individual, Business, or Enterprise
2. **VS Code** with the GitHub Copilot extension installed and authenticated

## Installation

### From Source

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to launch the extension in a new VS Code window

### Manual Install

1. Run `npm run compile`
2. Package with `vsce package` (requires `npm install -g @vscode/vsce`)
3. Install the generated `.vsix` file in VS Code

## Usage

### Starting the Server

The server starts automatically by default. You can also:

- Use Command Palette: `LLM Proxy: Start Server`
- Click the status bar item to see status and controls

### API Endpoints

Once running, the following endpoints are available:

#### POST `/v1/chat/completions`

OpenAI-compatible chat completions endpoint.

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

**Request Body:**
- `model` (optional): Model ID or partial name to match
- `messages`: Array of chat messages with `role` and `content`
- `stream` (optional): Set to `true` for streaming responses
- `temperature` (optional): Not currently used by VS Code API
- `max_tokens` (optional): Not currently used by VS Code API

#### GET `/v1/models`

List available models.

```bash
curl http://localhost:8080/v1/models
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "copilot-claude-3.5-sonnet",
      "object": "model",
      "owned_by": "copilot",
      "name": "Claude 3.5 Sonnet",
      "family": "claude-3.5-sonnet",
      "maxInputTokens": 16384
    }
  ]
}
```

#### GET `/health`

Health check endpoint.

```bash
curl http://localhost:8080/health
```

## Configuration

Settings available in VS Code Settings (search for "LLM Proxy"):

| Setting | Default | Description |
|---------|---------|-------------|
| `llmProxy.port` | `8080` | Port number for the proxy server |
| `llmProxy.autoStart` | `true` | Automatically start when VS Code opens |
| `llmProxy.defaultModel` | `""` | Default model when not specified in request |

## Using with External Tools

### With Python (OpenAI client)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="not-needed"  # Any value works
)

response = client.chat.completions.create(
    model="claude-3.5-sonnet",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### With curl (streaming)

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "Write a haiku"}],
    "stream": true
  }'
```

### With Node.js

```javascript
const response = await fetch('http://localhost:8080/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        model: 'claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hello!' }]
    })
});
const data = await response.json();
console.log(data.choices[0].message.content);
```

## Commands

- `LLM Proxy: Start Server` - Start the proxy server
- `LLM Proxy: Stop Server` - Stop the proxy server
- `LLM Proxy: Show Status` - Show server status and available models

## Troubleshooting

### "No language models available"

- Ensure GitHub Copilot extension is installed
- Ensure you're signed into GitHub with Copilot access
- Try running `GitHub Copilot: Sign In` from Command Palette

### "Port already in use"

- Change the port in settings (`llmProxy.port`)
- Or stop whatever is using that port

### Model not found

- Use `GET /v1/models` to see available models
- Model matching is flexible: `claude`, `sonnet`, or `claude-3.5-sonnet` all work

## License

MIT
