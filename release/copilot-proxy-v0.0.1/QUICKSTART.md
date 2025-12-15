# Copilot Proxy - Quick Start

Turn your GitHub Copilot subscription into an OpenAI-compatible API.

## Prerequisites

- VS Code installed
- GitHub Copilot extension installed and authenticated
- Active GitHub Copilot subscription

## Installation

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Mac/Linux

```bash
chmod +x install.sh
./install.sh
```

After installing, reload VS Code (Ctrl/Cmd+Shift+P -> "Reload Window").

## Test It

The server starts automatically on port 8080.

```bash
# Health check
curl http://localhost:8080/health

# List available models
curl http://localhost:8080/v1/models

# Chat completion
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'
```

## Use with Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="claude-3.5-sonnet",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## Configuration

Open VS Code Settings and search for "Copilot Proxy":

| Setting | Default | Description |
|---------|---------|-------------|
| Port | 8080 | Server port |
| Auto Start | true | Start when VS Code opens |
| Default Model | (empty) | Default model to use |

## Commands

- `Copilot Proxy: Start Server` - Start the server
- `Copilot Proxy: Stop Server` - Stop the server
- `Copilot Proxy: Show Status` - Open status panel

## Troubleshooting

**"No language models available"**
- Make sure GitHub Copilot is installed and you're signed in

**"Port already in use"**
- Change the port in settings, or stop the other process

**Server not responding**
- Check the Output panel (select "Copilot Proxy" dropdown)

## More Info

See the full README at: https://github.com/gratajik/vscode-copilot-proxy
