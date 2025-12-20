# Tool/Function Calling Support - Tasks

## PHASE 1: CORE INTERFACES

**Status:** Not Started
**Progress:** 0/5 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 1.1 Type Definitions

- [ ] **1.1.1** Add Tool interface to core.ts
  - Define `Tool`, `ToolFunction`, `ToolCall`, `ToolCallDelta` interfaces
  - Match OpenAI API specification exactly

- [ ] **1.1.2** Extend ChatMessage interface
  - Add optional `tool_calls` array for assistant messages
  - Add optional `tool_call_id` for tool result messages
  - Add optional `name` for tool identification
  - Add `'tool'` to role union type

- [ ] **1.1.3** Extend ChatCompletionRequest interface
  - Add optional `tools` array
  - Add optional `tool_choice` field

- [ ] **1.1.4** Update response interfaces
  - Extend `OpenAIResponse` choices to include `tool_calls`
  - Add `'tool_calls'` to `finish_reason` options
  - Extend `StreamChunk` delta to include `tool_calls`

- [ ] **1.1.5** Add helper functions to core.ts
  - `generateToolCallId()` - Generate unique tool call IDs
  - `convertToVSCodeTools()` - Convert OpenAI tools to VS Code format
  - `convertToolCallPart()` - Convert VS Code tool call to OpenAI format

---

## PHASE 2: TOOLS ENDPOINT & REQUEST HANDLING

**Status:** Not Started
**Progress:** 0/6 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 2.1 Tools List Endpoint

- [ ] **2.1.1** Implement GET /v1/tools endpoint
  - Read available tools from vscode.lm.tools
  - Return in standardized format (name, description, inputSchema, tags)
  - Add CORS headers

- [ ] **2.1.2** Add ToolInfo interface to core.ts
  - Define response structure matching OpenAI-style list format
  - Include optional fields (inputSchema, tags)

- [ ] **2.1.3** Add tool filtering support
  - Parse `tags` query parameter (comma-separated)
  - Parse `name` query parameter (wildcard pattern)
  - Filter tools before returning response

### 2.2 Tool Validation

- [ ] **2.2.1** Add tool validation in validateRequest()
  - Validate tools array structure
  - Validate each tool has type: 'function'
  - Validate function has name
  - Validate parameters is valid JSON Schema (if provided)

- [ ] **2.2.2** Add tool message validation
  - Validate tool role messages have tool_call_id
  - Validate tool_call_id references exist (optional, warn only)

### 2.3 Message Conversion

- [ ] **2.3.1** Update convertToVSCodeMessages()
  - Handle assistant messages with tool_calls
  - Convert tool role messages to LanguageModelToolResultPart
  - Preserve tool call context in conversation

- [ ] **2.3.2** Build VS Code request options with tools
  - Convert tools array to LanguageModelChatTool format
  - Map tool_choice to VS Code toolMode
  - Pass options to sendRequest()

---

## PHASE 3: RESPONSE HANDLING

**Status:** Not Started
**Progress:** 0/4 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 3.1 Non-Streaming Responses

- [ ] **3.1.1** Detect tool call parts in response
  - Check for LanguageModelToolCallPart instances
  - Collect all tool calls from response stream

- [ ] **3.1.2** Build response with tool calls
  - Set finish_reason to 'tool_calls' when tools are called
  - Include tool_calls array in message
  - Handle mixed content + tool call responses

### 3.2 Streaming Responses

- [ ] **3.2.1** Stream tool call deltas
  - Send tool call chunks with proper delta format
  - Track tool call index for multi-tool responses
  - Stream function arguments incrementally

- [ ] **3.2.2** Handle stream finish with tool calls
  - Set correct finish_reason in final chunk
  - Ensure all tool calls are complete before [DONE]

---

## PHASE 4: AUTO-EXECUTE MODE

**Status:** Not Started
**Progress:** 0/6 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 4.1 Request Options

- [ ] **4.1.1** Add proxy-specific request fields
  - `use_vscode_tools: boolean` - Include all VS Code tools
  - `tool_execution: 'none' | 'auto'` - Execution mode
  - `max_tool_rounds: number` - Iteration limit (default: 10)

- [ ] **4.1.2** Implement use_vscode_tools option
  - Read tools from vscode.lm.tools
  - Merge with any custom tools in request
  - Convert all to LanguageModelChatTool format

### 4.2 Tool Execution Loop

- [ ] **4.2.1** Implement tool invocation
  - Call vscode.lm.invokeTool() for each tool call
  - Handle tool errors gracefully
  - Collect LanguageModelToolResult

- [ ] **4.2.2** Implement execution loop
  - After tool calls, add results to messages
  - Re-send request to model
  - Loop until no more tool calls or max_tool_rounds reached

- [ ] **4.2.3** Build final response
  - Return final model response (no tool_calls)
  - Include all content from final iteration
  - Set finish_reason to 'stop'

### 4.3 Error Handling

- [ ] **4.3.1** Handle auto-execute errors
  - Tool invocation failures - include error in result
  - Max rounds exceeded - return partial with warning
  - Model errors during loop - return error response

---

## PHASE 5: UNIT TESTING

**Status:** Not Started
**Progress:** 0/8 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 5.1 Tool Interface Tests (src/test/tools.test.ts)

- [ ] **5.1.1** Test generateToolCallId()
  - Should generate unique IDs
  - Should have correct prefix format (call_*)
  - Should generate many unique IDs without collision

- [ ] **5.1.2** Test convertToVSCodeTools()
  - Should convert single tool correctly
  - Should convert multiple tools
  - Should handle missing optional fields (description, parameters)
  - Should preserve JSON Schema in parameters

- [ ] **5.1.3** Test convertToolCallPart()
  - Should convert tool call to OpenAI format
  - Should JSON stringify the input object
  - Should generate ID if missing

### 5.2 Validation Tests

- [ ] **5.2.1** Test validateTools() function
  - Should pass valid tools array
  - Should fail if tool missing type
  - Should fail if type is not 'function'
  - Should fail if function missing name
  - Should pass with minimal tool (just name)
  - Should validate parameters as valid JSON Schema

- [ ] **5.2.2** Test tool message validation
  - Should pass tool role message with tool_call_id
  - Should fail tool role message without tool_call_id
  - Should pass assistant message with tool_calls array
  - Should validate tool_calls structure

### 5.3 Response Creation Tests

- [ ] **5.3.1** Test createOpenAIResponse with tool_calls
  - Should include tool_calls in message when provided
  - Should set finish_reason to 'tool_calls'
  - Should set content to null when only tool_calls
  - Should handle mixed content + tool_calls

### 5.4 Tool Filtering Tests

- [ ] **5.4.1** Test tool filtering functions
  - Should filter by single tag
  - Should filter by multiple tags (AND logic)
  - Should filter by name pattern with wildcards
  - Should handle empty filter (return all)

---

## PHASE 6: INTEGRATION TESTING

**Status:** Not Started
**Progress:** 0/7 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 6.1 HTTP Endpoint Tests (src/test/integration/tools.integration.test.ts)

- [ ] **6.1.1** Create test HTTP server harness
  - Mock VS Code LM API responses
  - Simulate tool call responses from model
  - Support both streaming and non-streaming

- [ ] **6.1.2** Test GET /v1/tools endpoint
  - Should return list of available tools
  - Should filter by tags query parameter
  - Should filter by name pattern
  - Should handle no tools available

- [ ] **6.1.3** Test tool request parsing
  - Should accept request with tools array
  - Should accept request with tool_choice
  - Should reject malformed tools
  - Should pass tools to VS Code API

- [ ] **6.1.4** Test non-streaming tool call response
  - Should return tool_calls in response
  - Should set finish_reason to 'tool_calls'
  - Should return proper OpenAI format

- [ ] **6.1.5** Test streaming tool call response
  - Should stream tool call deltas correctly
  - Should handle multiple tool calls
  - Should send proper [DONE] signal

- [ ] **6.1.6** Test tool result flow
  - Should accept tool role messages
  - Should convert tool results to VS Code format
  - Should complete conversation after tool result

- [ ] **6.1.7** Test auto-execute mode
  - Should invoke tools via vscode.lm.invokeTool
  - Should loop until no more tool calls
  - Should respect max_tool_rounds limit
  - Should return final response without tool_calls

---

## PHASE 7: END-TO-END TESTING

**Status:** Not Started
**Progress:** 0/8 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 7.1 E2E Test Infrastructure (src/test/e2e/tools.e2e.test.ts)

- [ ] **7.1.1** Create E2E test runner
  - Requires VS Code extension host running
  - Connects to real proxy server
  - Uses real VS Code LM API
  - Skip tests if VS Code not available

- [ ] **7.1.2** Add npm script for E2E tests
  - `npm run test:e2e` - Run E2E tests
  - Requires running VS Code with extension loaded
  - Document setup in README

### 7.2 Real Tool Calling Tests

- [ ] **7.2.1** Test GET /v1/tools with real VS Code
  - Verify tools list is populated
  - Verify tool metadata is correct
  - Test filtering works

- [ ] **7.2.2** Test with VS Code built-in tools
  - Query vscode.lm.tools for available tools
  - Make request with available tool definitions
  - Verify model can invoke tools
  - Document which tools are commonly available

- [ ] **7.2.3** Test custom tool definition
  - Define simple test tool (e.g., get_current_time)
  - Send request asking question that triggers tool
  - Verify tool_calls response format
  - Verify arguments are properly formatted

- [ ] **7.2.4** Test tool result round-trip
  - Send initial request with tools
  - Receive tool_calls response
  - Send follow-up with tool result
  - Verify final response incorporates result

- [ ] **7.2.5** Test auto-execute with real tools
  - Send request with use_vscode_tools: true
  - Set tool_execution: 'auto'
  - Verify proxy executes tools and returns final answer
  - Measure latency for multi-round execution

- [ ] **7.2.6** Test streaming with real model
  - Enable streaming for tool request
  - Verify tool_calls stream correctly
  - Verify delta format is correct
  - Time the streaming response

---

## PHASE 8: DOCUMENTATION & EXAMPLES

**Status:** Not Started
**Progress:** 0/6 tasks complete (0%)
**Phase Started:** TBD
**Last Updated:** 2025-12-20
**Phase Completed:** TBD

### 8.1 README Updates

- [ ] **8.1.1** Add tool calling section to README
  - Basic usage example with curl
  - Streaming example
  - Tool result flow example

- [ ] **8.1.2** Document auto-execute mode
  - use_vscode_tools usage
  - tool_execution: 'auto' examples
  - Agentic workflow examples

- [ ] **8.1.3** Document E2E test setup
  - Prerequisites (VS Code, extension loaded)
  - How to run E2E tests
  - Troubleshooting common issues

### 8.2 Example Scripts (examples/)

- [ ] **8.2.1** Create examples/vscode_llm_tools_simple.py
  - Basic tool calling with pass-through mode
  - Define simple tool (e.g., get_weather)
  - Handle tool_calls response
  - Send tool result and get final answer
  - Follow existing example style/format

- [ ] **8.2.2** Create examples/vscode_llm_tools_auto.py
  - Auto-execute mode example
  - use_vscode_tools: true with tool_execution: 'auto'
  - Show agentic workflow (ask question, get answer)
  - Include error handling
  - Demonstrate max_tool_rounds usage

- [ ] **8.2.3** Create examples/vscode_llm_list_tools.py
  - List available VS Code tools
  - Show filtering by tags and name
  - Display tool schemas
  - Useful for discovering what tools are available

---

## Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Core Interfaces | 5 | Not Started |
| Phase 2: Tools Endpoint & Request Handling | 7 | Not Started |
| Phase 3: Response Handling | 4 | Not Started |
| Phase 4: Auto-Execute Mode | 6 | Not Started |
| Phase 5: Unit Testing | 8 | Not Started |
| Phase 6: Integration Testing | 7 | Not Started |
| Phase 7: End-to-End Testing | 8 | Not Started |
| Phase 8: Documentation & Examples | 6 | Not Started |
| **Total** | **51** | **0% Complete** |

---

## Test File Structure

```
src/test/
  core.test.ts                  # Existing core tests
  tools.test.ts                 # NEW: Unit tests for tool functions
  tools-filtering.test.ts       # NEW: Tool filtering tests
  tools-auto-execute.test.ts    # NEW: Auto-execute mode tests
  integration/
    tools.integration.test.ts   # NEW: HTTP endpoint integration tests
    tools-endpoint.test.ts      # NEW: GET /v1/tools tests
  e2e/
    tools.e2e.test.ts           # NEW: Real VS Code E2E tests
    auto-execute.e2e.test.ts    # NEW: Auto-execute E2E tests
    README.md                   # E2E test setup instructions
```

## Running Tests

```bash
# Unit tests (no VS Code required)
npm test

# Integration tests (mocked VS Code API)
npm run test:integration

# E2E tests (requires VS Code with extension running)
npm run test:e2e

# All tests
npm run test:all
```

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
