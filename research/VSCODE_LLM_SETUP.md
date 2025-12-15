# Using VS Code LLM (GitHub Copilot) with External Applications

This guide explains how to use VS Code's language model API with external applications, giving you access to Copilot models through your GitHub Copilot subscription - **no additional API costs**!

## Prerequisites

1. **GitHub Copilot Subscription** - Individual, Business, or Enterprise
2. **VS Code** with the GitHub Copilot extension installed and authenticated

## Setup Instructions

### Option 1: Use Copilot Proxy Extension (Recommended)

The Copilot Proxy extension provides a local OpenAI-compatible server that exposes your Copilot models.

1. **Install Copilot Proxy Extension**:
   - Install from VSIX or VS Code marketplace
   - The server starts automatically when VS Code opens

2. **Configure your application**:
   ```bash
   # Endpoint
   VSCODE_LLM_ENDPOINT=http://127.0.0.1:8080/v1/chat/completions
   ```

3. **Test the connection**:
   ```bash
   curl http://127.0.0.1:8080/health
   curl http://127.0.0.1:8080/v1/models
   ```

### Option 2: Use LM Studio

LM Studio provides a local OpenAI-compatible server that can route to various providers.

1. **Download LM Studio**: https://lmstudio.ai/
2. **Start the Local Server**:
   - Open LM Studio
   - Go to "Local Server" tab
   - Click "Start Server"
   - Note the endpoint (usually `http://localhost:1234/v1/chat/completions`)

3. **Configure your application**:
   ```bash
   VSCODE_LLM_ENDPOINT=http://localhost:1234/v1/chat/completions
   ```

### Option 3: Use Continue.dev Extension

Continue.dev is a VS Code extension that provides an OpenAI-compatible API.

1. **Install Continue Extension**:
   - Open VS Code
   - Install "Continue" extension from marketplace

2. **Configure Continue**:
   - Open Continue settings (`.continue/config.json`)
   - Set Claude as your provider
   - Start the Continue server

3. **Configure your application**:
   ```bash
   VSCODE_LLM_ENDPOINT=http://localhost:65432/v1/chat/completions
   ```

## Testing the Setup

Test with curl:

```bash
# Health check
curl http://127.0.0.1:8080/health

# List models
curl http://127.0.0.1:8080/v1/models

# Send a request
curl -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3.5-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Benefits of Using VS Code LLM

- **Free with Copilot** - No additional API costs beyond your Copilot subscription
- **Multiple Models** - Access to Claude, GPT-4o, and other Copilot models
- **No Credit Limits** - Use as much as you want within Copilot's fair use policy
- **Integrated** - Works seamlessly with your dev environment
- **OpenAI Compatible** - Works with any tool expecting OpenAI API format

## Cost Comparison

| Option | Per Request | Monthly |
|--------|-------------|---------|
| Direct Anthropic API | ~$0.003-0.015 | Variable |
| Direct OpenAI API | ~$0.002-0.06 | Variable |
| **VS Code LLM (Copilot)** | **FREE** | **Included in Copilot** |

## Known Limitations

### System Messages

VS Code's LM API doesn't have a system role. System messages are automatically converted to user messages.

### Token Counts

Token counts in responses are always 0 - VS Code's API doesn't expose this information.

### Temperature/Max Tokens

These parameters are accepted but not forwarded to the underlying API.

### Request Size Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| Request body size | 10 MB | Prevents memory exhaustion |
| Request timeout | 30 seconds | Prevents connection exhaustion |

## Automatic Retry and Fallback

VS Code Copilot has content filters that may occasionally block responses. When implementing your own client, consider:

### Retry Logic

When a request is filtered or returns empty:
1. Retry up to 3 times with exponential backoff (2s, 4s, 8s)
2. Content filters are somewhat random - retrying often succeeds

### Fallback Strategy

If retries are exhausted:
1. Optionally fall back to direct API (Anthropic/OpenAI) for that request
2. Log when fallback occurs so you're aware of paid API calls
3. Continue using VS Code LLM for subsequent requests

### Example Configuration

```bash
# Max retries before fallback (default: 3)
VSCODE_LLM_MAX_RETRIES=3

# Enable/disable fallback to paid API (default: true)
VSCODE_LLM_FALLBACK=true

# Fallback API key (optional - enables fallback)
ANTHROPIC_API_KEY=your_key_here
# or
OPENAI_API_KEY=your_key_here
```

### What Gets Filtered?

Copilot's filters may block content involving:
- Political figures / authority characters
- Military / law enforcement characters
- Violence descriptions
- Other sensitive themes

## Troubleshooting

**Issue**: "Failed to connect to VS Code LLM API"
- Make sure VS Code is running with Copilot Proxy extension active
- Check that the server is running (status bar shows port)

**Issue**: "No language models available"
- Ensure GitHub Copilot extension is installed and authenticated
- Try running `GitHub Copilot: Sign In` from Command Palette

**Issue**: Auth errors despite correct endpoint
- Check that `VSCODE_LLM_ENDPOINT` URL is correct
- Verify server is running: `curl http://127.0.0.1:8080/health`

**Issue**: Slow response times
- First requests may be slower while models initialize
- Subsequent requests are faster

**Issue**: "Response got filtered" errors
- This is Copilot's content filter
- Implement retry logic with exponential backoff
- Consider fallback to direct API for filtered content

**Issue**: "Port already in use"
- Change the port in VS Code settings (`copilotProxy.port`)
- Or stop the other application using that port

## Example Client Code

### Python with OpenAI Client

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="not-needed"  # Any value works
)

response = client.chat.completions.create(
    model="claude-3.5-sonnet",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### Python with Streaming

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="not-needed"
)

stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Write a short poem"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Node.js

```javascript
const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
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

### LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="not-needed",
    model="claude-3.5-sonnet"
)

response = llm.invoke("What is the capital of France?")
print(response.content)
```

## Next Steps

Once configured, you can use your Copilot subscription with any OpenAI-compatible tool or framework!

- Use with LangChain, LlamaIndex, or other AI frameworks
- Power your own scripts and automation
- Integrate with development tools expecting OpenAI API
