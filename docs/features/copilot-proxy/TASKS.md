# TASKS.md - LLM Proxy

## Overview

Task tracking for the LLM Proxy VS Code extension - an OpenAI-compatible HTTP server that proxies requests through VS Code's Language Model API (GitHub Copilot).

---

## PHASE 1: CORE IMPLEMENTATION

**Status:** Done
**Progress:** 10/10 tasks complete (100%)
**Phase Started**: 2024-12-01
**Phase Completed**: 2024-12-10

### 1.1 Project Setup

- [x] **1.1.1** Initialize VS Code extension project structure
- [x] **1.1.2** Configure TypeScript and build system
- [x] **1.1.3** Create package.json with extension manifest

### 1.2 HTTP Server

- [x] **1.2.1** Implement HTTP server with Node.js `http` module
- [x] **1.2.2** Add CORS support for browser-based clients
- [x] **1.2.3** Implement request routing

### 1.3 API Endpoints

- [x] **1.3.1** Implement `POST /v1/chat/completions` endpoint
  - Non-streaming response support
  - Streaming response support (SSE)
- [x] **1.3.2** Implement `GET /v1/models` endpoint
- [x] **1.3.3** Implement `GET /health` endpoint

### 1.4 VS Code Integration

- [x] **1.4.1** Integrate with `vscode.lm` API for model access
- [x] **1.4.2** Implement flexible model selection strategy
- [x] **1.4.3** Convert OpenAI message format to VS Code format

### 1.5 User Interface

- [x] **1.5.1** Create status bar item showing server state
- [x] **1.5.2** Register extension commands (start/stop/status)
- [x] **1.5.3** Add extension configuration settings

---

## PHASE 2: ENHANCEMENTS

**Status:** Not Started
**Progress:** 0/12 tasks complete (0%)

### 2.1 Authentication

- [ ] **2.1.1** Add optional API key authentication
  - Configure via `llmProxy.apiKey` setting
  - Validate `Authorization: Bearer <key>` header
  - Return 401 for invalid/missing key when enabled

### 2.2 Rate Limiting

- [ ] **2.2.1** Implement request rate limiting
  - Configure via `llmProxy.rateLimit` (requests per minute)
  - Track requests by client IP
  - Return 429 when rate limit exceeded

### 2.3 Logging

- [ ] **2.3.1** Add optional request/response logging
  - Configure via `llmProxy.enableLogging` setting
  - Log to VS Code Output channel
- [ ] **2.3.2** Add request timing metrics
  - Log request duration
  - Track average response times

### 2.4 Metrics

- [ ] **2.4.1** Add Prometheus-compatible metrics endpoint
  - `GET /metrics` endpoint
  - Track request counts, latencies, errors
- [ ] **2.4.2** Add request statistics to status display
  - Total requests served
  - Active connections
  - Error rate

### 2.5 Advanced Configuration

- [ ] **2.5.1** Support binding to specific network interfaces
  - Configure via `llmProxy.host` setting
  - Default to `127.0.0.1` (localhost only)
- [ ] **2.5.2** Support multiple ports
  - Configure via `llmProxy.additionalPorts` array
- [ ] **2.5.3** Add request timeout configuration
  - Configure via `llmProxy.requestTimeout` setting

### 2.6 Protocol Support

- [ ] **2.6.1** Add WebSocket support as alternative to SSE streaming
  - `ws://localhost:8080/v1/chat/completions`
  - Same request/response format as HTTP
- [ ] **2.6.2** Add tool/function calling support (when VS Code API supports it)
  - Parse `tools` array from request
  - Forward tool definitions to model
  - Return tool calls in response

---

## PHASE 3: POLISH & DOCUMENTATION

**Status:** Not Started
**Progress:** 0/6 tasks complete (0%)

### 3.1 Error Handling

- [ ] **3.1.1** Improve error messages with actionable guidance
- [ ] **3.1.2** Add retry logic for transient failures

### 3.2 Testing

- [ ] **3.2.1** Create integration test suite
  - Test with Python `openai` client
  - Test with Node.js `openai` package
  - Test streaming behavior
- [ ] **3.2.2** Add compatibility testing with common tools
  - LangChain
  - Continue.dev
  - Other OpenAI-compatible clients

### 3.3 Publishing

- [ ] **3.3.1** Prepare extension for VS Code Marketplace
  - Add icon and branding
  - Write marketplace description
  - Configure extension categories
- [ ] **3.3.2** Create release automation
  - Version bumping
  - Changelog generation
  - VSIX packaging

---

## Known Limitations

These are VS Code LM API limitations, not implementation tasks:

- Token counts not available (always returns 0)
- System role treated as user messages
- `temperature` and `max_tokens` accepted but not forwarded
- Function/tool calling not supported by API

---

## References

- Design document: `docs/features/llm-proxy/design.md`
- VS Code LM API: https://code.visualstudio.com/api/extension-guides/language-model
- OpenAI API reference: https://platform.openai.com/docs/api-reference

---

**Last Updated**: 2024-12-11
**Last Updated By**: Claude Code
