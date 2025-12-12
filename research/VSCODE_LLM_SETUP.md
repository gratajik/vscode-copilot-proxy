# Using BookGen with VS Code LLM (GitHub Copilot)

This guide explains how to use BookGen with VS Code's language model API, which gives you access to Claude Sonnet through your GitHub Copilot subscription - **no additional API costs**!

## Prerequisites

1. **GitHub Copilot Subscription** - Individual, Business, or Enterprise
2. **VS Code** with the GitHub Copilot extension installed
3. **Python 3.11+** installed

## Setup Instructions

### Option 1: Use LM Studio (Recommended - Easiest)

LM Studio provides a local OpenAI-compatible server that can route to various providers including Claude.

1. **Download LM Studio**: https://lmstudio.ai/
2. **Start the Local Server**:
   - Open LM Studio
   - Go to "Local Server" tab
   - Click "Start Server"
   - Note the endpoint (usually `http://localhost:1234/v1/chat/completions`)

3. **Configure your `.env` file**:
   ```bash
   USE_VSCODE_LLM=true
   VSCODE_LLM_ENDPOINT=http://localhost:1234/v1/chat/completions
   ```

4. **Run BookGen** - it will now use LM Studio instead of direct Anthropic API!

### Option 2: Use Continue.dev Extension

Continue.dev is a VS Code extension that provides an OpenAI-compatible API.

1. **Install Continue Extension**: 
   - Open VS Code
   - Install "Continue" extension from marketplace

2. **Configure Continue**:
   - Open Continue settings (`.continue/config.json`)
   - Set Claude as your provider
   - Start the Continue server

3. **Update `.env`**:
   ```bash
   USE_VSCODE_LLM=true
   VSCODE_LLM_ENDPOINT=http://localhost:65432/v1/chat/completions
   ```

### Option 3: Direct VS Code Extension API (Advanced)

Create a small VS Code extension that exposes the language model API:

1. Create `vscode-llm-server` extension (see below)
2. Start the extension
3. Configure BookGen to use it

## Testing the Setup

Run the simple test to verify everything works:

```bash
python test_simple.py
```

You should see:
```
✓ API key found
✓ Using VS Code LLM provider (GitHub Copilot)
📋 PHASE 1: STORY PLANNING
...
```

## Benefits of Using VS Code LLM

✅ **Free with Copilot** - No additional API costs beyond your Copilot subscription  
✅ **Same Claude Sonnet** - Access to the same powerful model  
✅ **No Credit Limits** - Use as much as you want  
✅ **Integrated** - Works seamlessly with your dev environment  

## Cost Comparison

| Option | 2-Chapter Book | 25-Chapter Book |
|--------|---------------|-----------------|
| Direct Anthropic API | ~$1-2 | ~$20-40 |
| **VS Code LLM (Copilot)** | **FREE** | **FREE** |

## Switching Back to Direct API

Simply change your `.env`:

```bash
USE_VSCODE_LLM=false
ANTHROPIC_API_KEY=your_key_here
```

## Troubleshooting

**Issue**: "Failed to connect to VS Code LLM API"  
**Solution**: Make sure your local server (LM Studio/Continue) is running

**Issue**: "Using VS Code LLM" but still getting auth errors  
**Solution**: Check that `VSCODE_LLM_ENDPOINT` is correct

**Issue**: Slow response times  
**Solution**: This is normal for first requests; subsequent ones are faster

## Sample VS Code Extension Server

If you want to create your own server extension:

```typescript
// extension.ts
import * as vscode from 'vscode';
import * as express from 'express';

export function activate(context: vscode.ExtensionContext) {
    const app = express();
    app.use(express.json());

    app.post('/v1/chat/completions', async (req, res) => {
        const { messages, temperature, max_tokens } = req.body;
        
        // Use VS Code's language model API
        const [model] = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'claude-3.5-sonnet'
        });

        const chatMessages = messages.map((m: any) => 
            vscode.LanguageModelChatMessage.User(m.content)
        );

        const response = await model.sendRequest(chatMessages);
        
        let content = '';
        for await (const chunk of response.text) {
            content += chunk;
        }

        res.json({
            choices: [{
                message: { content },
                index: 0,
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        });
    });

    app.listen(8080, () => {
        console.log('VS Code LLM Server running on port 8080');
    });
}
```

## Next Steps

Once configured, you can generate complete books for free using your Copilot subscription!

```bash
# Generate a 2-chapter test book
python test_simple.py

# Or use the CLI
bookgen create --title "My Novel" --author "Your Name" --chapters 25
```

Happy writing! 📚✨
