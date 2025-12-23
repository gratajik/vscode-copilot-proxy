import { expect } from 'chai';
import {
    escapeHtml,
    generateId,
    estimateTokens,
    calculateContextSize,
    extractVersion,
    scoreModelMatch,
    findBestModel,
    createOpenAIResponse,
    createStreamChunk,
    createErrorResponse,
    parseRequestBody,
    validateRequest,
    formatLogMessage,
    formatErrorMessage,
    MODEL_KEY_IDENTIFIERS,
    MODEL_SCORE,
    MAX_REQUEST_BODY_SIZE,
    REQUEST_TIMEOUT_MS,
    KEEP_ALIVE_TIMEOUT_MS,
    MODEL_CACHE_TTL_MS,
    DEFAULT_MAX_TOOL_ROUNDS,
    ChatMessage,
    ChatCompletionRequest,
    Tool,
    ToolCall,
    ToolInfo,
    generateToolCallId,
    validateTools,
    createOpenAIResponseWithTools,
    createStreamChunkWithTools,
    filterToolsByTags,
    filterToolsByName
} from '../core';

describe('Core Utilities', () => {

    describe('escapeHtml', () => {
        it('should escape ampersand', () => {
            expect(escapeHtml('foo & bar')).to.equal('foo &amp; bar');
        });

        it('should escape less than', () => {
            expect(escapeHtml('foo < bar')).to.equal('foo &lt; bar');
        });

        it('should escape greater than', () => {
            expect(escapeHtml('foo > bar')).to.equal('foo &gt; bar');
        });

        it('should escape double quotes', () => {
            expect(escapeHtml('foo "bar"')).to.equal('foo &quot;bar&quot;');
        });

        it('should escape single quotes', () => {
            expect(escapeHtml("foo 'bar'")).to.equal('foo &#039;bar&#039;');
        });

        it('should escape multiple special characters', () => {
            expect(escapeHtml('<script>alert("XSS")</script>')).to.equal(
                '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
            );
        });

        it('should handle empty string', () => {
            expect(escapeHtml('')).to.equal('');
        });

        it('should handle string with no special characters', () => {
            expect(escapeHtml('Hello World')).to.equal('Hello World');
        });

        it('should handle unicode characters', () => {
            expect(escapeHtml('Hello 世界 🌍')).to.equal('Hello 世界 🌍');
        });
    });

    describe('generateId', () => {
        it('should start with chatcmpl-', () => {
            const id = generateId();
            expect(id).to.match(/^chatcmpl-/);
        });

        it('should generate unique IDs', () => {
            const ids = new Set<string>();
            for (let i = 0; i < 100; i++) {
                ids.add(generateId());
            }
            expect(ids.size).to.equal(100);
        });

        it('should have reasonable length', () => {
            const id = generateId();
            expect(id.length).to.be.greaterThan(10);
            expect(id.length).to.be.lessThan(30);
        });
    });

    describe('estimateTokens', () => {
        it('should estimate 0 tokens for 0 characters', () => {
            expect(estimateTokens(0)).to.equal(0);
        });

        it('should estimate 1 token for 1-4 characters', () => {
            expect(estimateTokens(1)).to.equal(1);
            expect(estimateTokens(4)).to.equal(1);
        });

        it('should estimate 2 tokens for 5-8 characters', () => {
            expect(estimateTokens(5)).to.equal(2);
            expect(estimateTokens(8)).to.equal(2);
        });

        it('should round up for partial tokens', () => {
            expect(estimateTokens(9)).to.equal(3);
        });

        it('should handle large character counts', () => {
            expect(estimateTokens(10000)).to.equal(2500);
        });
    });

    describe('calculateContextSize', () => {
        it('should calculate for empty messages array', () => {
            const result = calculateContextSize([]);
            expect(result.messageCount).to.equal(0);
            expect(result.totalChars).to.equal(0);
            expect(result.estimatedTokens).to.equal(0);
        });

        it('should calculate for single message', () => {
            const messages: ChatMessage[] = [
                { role: 'user', content: 'Hello' }
            ];
            const result = calculateContextSize(messages);
            expect(result.messageCount).to.equal(1);
            expect(result.totalChars).to.equal(5);
            expect(result.estimatedTokens).to.equal(2);
        });

        it('should calculate for multiple messages', () => {
            const messages: ChatMessage[] = [
                { role: 'system', content: 'You are helpful' },
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' }
            ];
            const result = calculateContextSize(messages);
            expect(result.messageCount).to.equal(3);
            expect(result.totalChars).to.equal(29); // 15 + 5 + 9
            expect(result.estimatedTokens).to.equal(8);
        });
    });

    describe('extractVersion', () => {
        it('should extract version with hyphen separator', () => {
            expect(extractVersion('claude-4-5')).to.equal('4.5');
        });

        it('should extract version with dot separator', () => {
            expect(extractVersion('gpt-4.1')).to.equal('4.1');
        });

        it('should return null for no version', () => {
            expect(extractVersion('claude')).to.be.null;
        });

        it('should extract first version found', () => {
            expect(extractVersion('model-3-5-turbo-2-1')).to.equal('3.5');
        });

        it('should handle complex model names', () => {
            expect(extractVersion('claude-3.5-sonnet')).to.equal('3.5');
        });
    });

    describe('scoreModelMatch', () => {
        const claudeModel = { id: 'copilot-claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', family: 'claude-3.5-sonnet' };
        const gptModel = { id: 'copilot-gpt-4', name: 'GPT-4', family: 'gpt-4' };

        it('should score higher for matching key identifiers', () => {
            const claudeScore = scoreModelMatch('claude', claudeModel);
            const gptScore = scoreModelMatch('claude', gptModel);
            expect(claudeScore).to.be.greaterThan(gptScore);
        });

        it('should score higher for version match', () => {
            const exactScore = scoreModelMatch('claude-3.5', claudeModel);
            const noVersionScore = scoreModelMatch('claude', claudeModel);
            expect(exactScore).to.be.greaterThan(noVersionScore);
        });

        it('should penalize version mismatch', () => {
            const matchScore = scoreModelMatch('claude-3.5', claudeModel);
            const mismatchScore = scoreModelMatch('claude-4.0', claudeModel);
            expect(matchScore).to.be.greaterThan(mismatchScore);
        });

        it('should handle case insensitivity', () => {
            const lowerScore = scoreModelMatch('claude', claudeModel);
            const upperScore = scoreModelMatch('CLAUDE', claudeModel);
            expect(lowerScore).to.equal(upperScore);
        });

        it('should score multiple matching identifiers', () => {
            const opusSonnetModel = { id: 'opus-sonnet', name: 'Opus Sonnet', family: 'opus' };
            const singleMatch = scoreModelMatch('opus', opusSonnetModel);
            const doubleMatch = scoreModelMatch('opus sonnet', opusSonnetModel);
            expect(doubleMatch).to.be.greaterThan(singleMatch);
        });
    });

    describe('findBestModel', () => {
        const models = [
            { id: 'copilot-claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', family: 'claude-3.5-sonnet' },
            { id: 'copilot-gpt-4', name: 'GPT-4', family: 'gpt-4' },
            { id: 'copilot-gpt-4o', name: 'GPT-4o', family: 'gpt-4o' }
        ];

        it('should return undefined for empty models array', () => {
            expect(findBestModel('claude', [])).to.be.undefined;
        });

        it('should return first model when no request specified', () => {
            const result = findBestModel(undefined, models);
            expect(result).to.equal(models[0]);
        });

        it('should return first model for empty string request', () => {
            const result = findBestModel('', models);
            expect(result).to.equal(models[0]);
        });

        it('should find exact ID match', () => {
            const result = findBestModel('copilot-gpt-4', models);
            expect(result?.id).to.equal('copilot-gpt-4');
        });

        it('should find exact ID match case-insensitively', () => {
            const result = findBestModel('COPILOT-GPT-4', models);
            expect(result?.id).to.equal('copilot-gpt-4');
        });

        it('should find by family match', () => {
            const result = findBestModel('gpt-4o', models);
            expect(result?.id).to.equal('copilot-gpt-4o');
        });

        it('should use default model when request is empty', () => {
            const result = findBestModel('', models, 'copilot-gpt-4');
            expect(result?.id).to.equal('copilot-gpt-4');
        });

        it('should find best match by score', () => {
            const result = findBestModel('claude-3.5', models);
            expect(result?.family).to.include('claude');
        });

        it('should fall back to first model when no good match', () => {
            const result = findBestModel('nonexistent-model', models);
            expect(result).to.equal(models[0]);
        });
    });

    describe('createOpenAIResponse', () => {
        it('should create valid response structure', () => {
            const response = createOpenAIResponse('test-id', 'test-model', 'Hello!');
            expect(response.id).to.equal('test-id');
            expect(response.model).to.equal('test-model');
            expect(response.object).to.equal('chat.completion');
            expect(response.choices).to.have.length(1);
            expect(response.choices[0].message.content).to.equal('Hello!');
            expect(response.choices[0].message.role).to.equal('assistant');
            expect(response.choices[0].finish_reason).to.equal('stop');
        });

        it('should use provided timestamp', () => {
            const timestamp = 1234567890;
            const response = createOpenAIResponse('id', 'model', 'content', timestamp);
            expect(response.created).to.equal(timestamp);
        });

        it('should generate timestamp if not provided', () => {
            const before = Math.floor(Date.now() / 1000);
            const response = createOpenAIResponse('id', 'model', 'content');
            const after = Math.floor(Date.now() / 1000);
            expect(response.created).to.be.at.least(before);
            expect(response.created).to.be.at.most(after);
        });

        it('should have zero token counts (VS Code limitation)', () => {
            const response = createOpenAIResponse('id', 'model', 'content');
            expect(response.usage.prompt_tokens).to.equal(0);
            expect(response.usage.completion_tokens).to.equal(0);
            expect(response.usage.total_tokens).to.equal(0);
        });
    });

    describe('createStreamChunk', () => {
        it('should create initial chunk with role', () => {
            const chunk = createStreamChunk('id', 'model', undefined, 'assistant');
            expect(chunk.object).to.equal('chat.completion.chunk');
            expect(chunk.choices[0].delta.role).to.equal('assistant');
            expect(chunk.choices[0].delta.content).to.be.undefined;
            expect(chunk.choices[0].finish_reason).to.be.null;
        });

        it('should create content chunk', () => {
            const chunk = createStreamChunk('id', 'model', 'Hello');
            expect(chunk.choices[0].delta.content).to.equal('Hello');
            expect(chunk.choices[0].delta.role).to.be.undefined;
        });

        it('should create final chunk with finish_reason', () => {
            const chunk = createStreamChunk('id', 'model', undefined, undefined, 'stop');
            expect(chunk.choices[0].finish_reason).to.equal('stop');
        });

        it('should use provided timestamp', () => {
            const timestamp = 1234567890;
            const chunk = createStreamChunk('id', 'model', 'content', undefined, null, timestamp);
            expect(chunk.created).to.equal(timestamp);
        });
    });

    describe('createErrorResponse', () => {
        it('should create valid error structure', () => {
            const error = createErrorResponse('Not found', 'not_found', 404);
            expect(error.error.message).to.equal('Not found');
            expect(error.error.type).to.equal('not_found');
            expect(error.error.code).to.equal(404);
        });

        it('should handle different error types', () => {
            const error400 = createErrorResponse('Bad request', 'invalid_request_error', 400);
            const error500 = createErrorResponse('Server error', 'server_error', 500);
            const error503 = createErrorResponse('Unavailable', 'service_unavailable', 503);

            expect(error400.error.code).to.equal(400);
            expect(error500.error.code).to.equal(500);
            expect(error503.error.code).to.equal(503);
        });
    });

    describe('parseRequestBody', () => {
        it('should parse valid JSON', () => {
            const body = JSON.stringify({
                model: 'gpt-4',
                messages: [{ role: 'user', content: 'Hello' }]
            });
            const result = parseRequestBody(body);
            expect(result).to.not.be.null;
            expect(result?.model).to.equal('gpt-4');
            expect(result?.messages).to.have.length(1);
        });

        it('should return null for invalid JSON', () => {
            expect(parseRequestBody('not json')).to.be.null;
            expect(parseRequestBody('{')).to.be.null;
            expect(parseRequestBody('')).to.be.null;
        });

        it('should parse optional fields', () => {
            const body = JSON.stringify({
                messages: [{ role: 'user', content: 'Hi' }],
                stream: true,
                temperature: 0.7,
                max_tokens: 100
            });
            const result = parseRequestBody(body);
            expect(result?.stream).to.be.true;
            expect(result?.temperature).to.equal(0.7);
            expect(result?.max_tokens).to.equal(100);
        });
    });

    describe('validateRequest', () => {
        it('should pass valid request', () => {
            const request: ChatCompletionRequest = {
                messages: [{ role: 'user', content: 'Hello' }]
            };
            expect(validateRequest(request)).to.be.null;
        });

        it('should fail if messages is missing', () => {
            const request = {} as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('messages is required');
        });

        it('should fail if messages is not an array', () => {
            const request = { messages: 'not an array' } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('messages is required');
        });

        it('should fail if messages is empty', () => {
            const request: ChatCompletionRequest = { messages: [] };
            expect(validateRequest(request)).to.include('cannot be empty');
        });

        it('should fail for invalid role', () => {
            const request = {
                messages: [{ role: 'invalid', content: 'Hello' }]
            } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('role must be one of');
        });

        it('should fail for non-string content', () => {
            const request = {
                messages: [{ role: 'user', content: 123 }]
            } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('content must be a string');
        });

        it('should validate multiple messages', () => {
            const request: ChatCompletionRequest = {
                messages: [
                    { role: 'system', content: 'You are helpful' },
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi!' }
                ]
            };
            expect(validateRequest(request)).to.be.null;
        });

        it('should report index of invalid message', () => {
            const request = {
                messages: [
                    { role: 'user', content: 'Hello' },
                    { role: 'invalid', content: 'Bad' }
                ]
            } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('messages[1]');
        });
    });

    describe('formatLogMessage', () => {
        it('should include timestamp', () => {
            const message = formatLogMessage('Test message');
            expect(message).to.match(/^\[\d{1,2}:\d{2}:\d{2}/);
        });

        it('should include the message', () => {
            const message = formatLogMessage('Test message');
            expect(message).to.include('Test message');
        });
    });

    describe('formatErrorMessage', () => {
        it('should format message without error', () => {
            const message = formatErrorMessage('Something failed');
            expect(message).to.include('ERROR:');
            expect(message).to.include('Something failed');
        });

        it('should include error message from Error object', () => {
            const error = new Error('Detailed error');
            const message = formatErrorMessage('Operation failed', error);
            expect(message).to.include('Operation failed');
            expect(message).to.include('Detailed error');
        });

        it('should convert non-Error to string', () => {
            const message = formatErrorMessage('Failed', 'string error');
            expect(message).to.include('string error');
        });

        it('should handle null/undefined error', () => {
            const message1 = formatErrorMessage('Failed', null);
            const message2 = formatErrorMessage('Failed', undefined);
            expect(message1).to.include('Failed');
            expect(message2).to.include('Failed');
        });
    });

    describe('MODEL_KEY_IDENTIFIERS', () => {
        it('should include common model identifiers', () => {
            expect(MODEL_KEY_IDENTIFIERS).to.include('claude');
            expect(MODEL_KEY_IDENTIFIERS).to.include('gpt');
            expect(MODEL_KEY_IDENTIFIERS).to.include('opus');
            expect(MODEL_KEY_IDENTIFIERS).to.include('sonnet');
            expect(MODEL_KEY_IDENTIFIERS).to.include('haiku');
            expect(MODEL_KEY_IDENTIFIERS).to.include('gemini');
        });
    });

    describe('MODEL_SCORE', () => {
        it('should have positive version match score', () => {
            expect(MODEL_SCORE.VERSION_MATCH).to.be.greaterThan(0);
        });

        it('should have negative version mismatch penalty', () => {
            expect(MODEL_SCORE.VERSION_MISMATCH).to.be.lessThan(0);
        });

        it('should have positive key identifier match score', () => {
            expect(MODEL_SCORE.KEY_IDENTIFIER_MATCH).to.be.greaterThan(0);
        });

        it('should have version match as highest priority', () => {
            expect(MODEL_SCORE.VERSION_MATCH).to.be.greaterThan(MODEL_SCORE.KEY_IDENTIFIER_MATCH);
            expect(MODEL_SCORE.VERSION_MATCH).to.be.greaterThan(MODEL_SCORE.FAMILY_CONTAINMENT);
        });
    });

    describe('MAX_REQUEST_BODY_SIZE', () => {
        it('should be 10MB', () => {
            expect(MAX_REQUEST_BODY_SIZE).to.equal(10 * 1024 * 1024);
        });

        it('should be a positive number', () => {
            expect(MAX_REQUEST_BODY_SIZE).to.be.greaterThan(0);
        });
    });

    describe('REQUEST_TIMEOUT_MS', () => {
        it('should be 300 seconds (5 minutes)', () => {
            expect(REQUEST_TIMEOUT_MS).to.equal(300000);
        });

        it('should be a positive number', () => {
            expect(REQUEST_TIMEOUT_MS).to.be.greaterThan(0);
        });
    });

    describe('KEEP_ALIVE_TIMEOUT_MS', () => {
        it('should be 65 seconds', () => {
            expect(KEEP_ALIVE_TIMEOUT_MS).to.equal(65000);
        });

        it('should be a positive number', () => {
            expect(KEEP_ALIVE_TIMEOUT_MS).to.be.greaterThan(0);
        });
    });

    describe('MODEL_CACHE_TTL_MS', () => {
        it('should be 60 seconds', () => {
            expect(MODEL_CACHE_TTL_MS).to.equal(60000);
        });

        it('should be a positive number', () => {
            expect(MODEL_CACHE_TTL_MS).to.be.greaterThan(0);
        });
    });

    // ============================================================================
    // Tool Calling Tests
    // ============================================================================

    describe('DEFAULT_MAX_TOOL_ROUNDS', () => {
        it('should be 10', () => {
            expect(DEFAULT_MAX_TOOL_ROUNDS).to.equal(10);
        });
    });

    describe('generateToolCallId', () => {
        it('should start with call_', () => {
            const id = generateToolCallId();
            expect(id).to.match(/^call_/);
        });

        it('should generate unique IDs', () => {
            const ids = new Set<string>();
            for (let i = 0; i < 100; i++) {
                ids.add(generateToolCallId());
            }
            expect(ids.size).to.equal(100);
        });

        it('should have reasonable length', () => {
            const id = generateToolCallId();
            expect(id.length).to.be.greaterThan(10);
            expect(id.length).to.be.lessThan(40);
        });
    });

    describe('validateTools', () => {
        it('should pass valid tools array', () => {
            const tools: Tool[] = [{
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get weather info',
                    parameters: { type: 'object', properties: {} }
                }
            }];
            expect(validateTools(tools)).to.be.null;
        });

        it('should fail if tools is not an array', () => {
            expect(validateTools('not an array')).to.include('must be an array');
            expect(validateTools({})).to.include('must be an array');
        });

        it('should fail if tool is not an object', () => {
            expect(validateTools(['string'])).to.include('must be an object');
            expect(validateTools([null])).to.include('must be an object');
        });

        it('should fail if type is not function', () => {
            const tools = [{ type: 'invalid', function: { name: 'test' } }];
            expect(validateTools(tools)).to.include("must be 'function'");
        });

        it('should fail if function is missing', () => {
            const tools = [{ type: 'function' }];
            expect(validateTools(tools)).to.include('must be an object');
        });

        it('should fail if function.name is missing', () => {
            const tools = [{ type: 'function', function: {} }];
            expect(validateTools(tools)).to.include('must be a non-empty string');
        });

        it('should fail if function.name is empty', () => {
            const tools = [{ type: 'function', function: { name: '' } }];
            expect(validateTools(tools)).to.include('must be a non-empty string');
        });

        it('should pass with optional parameters', () => {
            const tools: Tool[] = [{
                type: 'function',
                function: { name: 'simple_tool' }
            }];
            expect(validateTools(tools)).to.be.null;
        });

        it('should fail if parameters is not an object', () => {
            const tools = [{
                type: 'function',
                function: { name: 'test', parameters: 'invalid' }
            }];
            expect(validateTools(tools)).to.include('must be an object');
        });

        it('should validate multiple tools', () => {
            const tools: Tool[] = [
                { type: 'function', function: { name: 'tool1' } },
                { type: 'function', function: { name: 'tool2' } }
            ];
            expect(validateTools(tools)).to.be.null;
        });

        it('should report index of invalid tool', () => {
            const tools = [
                { type: 'function', function: { name: 'valid' } },
                { type: 'invalid', function: { name: 'test' } }
            ];
            expect(validateTools(tools)).to.include('tools[1]');
        });
    });

    describe('validateRequest with tools', () => {
        it('should pass request with valid tools', () => {
            const request: ChatCompletionRequest = {
                messages: [{ role: 'user', content: 'Hello' }],
                tools: [{
                    type: 'function',
                    function: { name: 'get_weather' }
                }]
            };
            expect(validateRequest(request)).to.be.null;
        });

        it('should fail request with invalid tools', () => {
            const request = {
                messages: [{ role: 'user', content: 'Hello' }],
                tools: [{ type: 'invalid' }]
            } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include("must be 'function'");
        });

        it('should pass request with tool role message', () => {
            const request: ChatCompletionRequest = {
                messages: [
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: null, tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'test', arguments: '{}' } }] },
                    { role: 'tool', content: 'result', tool_call_id: 'call_123' }
                ]
            };
            expect(validateRequest(request)).to.be.null;
        });

        it('should fail tool message without tool_call_id', () => {
            const request = {
                messages: [
                    { role: 'tool', content: 'result' }
                ]
            } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('tool_call_id');
        });

        it('should pass assistant message with tool_calls', () => {
            const request: ChatCompletionRequest = {
                messages: [{
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: 'call_abc',
                        type: 'function',
                        function: { name: 'test', arguments: '{}' }
                    }]
                }]
            };
            expect(validateRequest(request)).to.be.null;
        });

        it('should fail if tool_calls is not an array', () => {
            const request = {
                messages: [{
                    role: 'assistant',
                    content: null,
                    tool_calls: 'not an array'
                }]
            } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('must be an array');
        });

        it('should fail if tool_call id is missing', () => {
            const request = {
                messages: [{
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ type: 'function', function: { name: 'test', arguments: '{}' } }]
                }]
            } as unknown as ChatCompletionRequest;
            expect(validateRequest(request)).to.include('id must be a string');
        });
    });

    describe('createOpenAIResponseWithTools', () => {
        it('should create response with tool calls', () => {
            const toolCalls: ToolCall[] = [{
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"NYC"}' }
            }];
            const response = createOpenAIResponseWithTools('id', 'model', null, toolCalls);

            expect(response.choices[0].message.tool_calls).to.have.length(1);
            expect(response.choices[0].message.tool_calls![0].id).to.equal('call_123');
            expect(response.choices[0].finish_reason).to.equal('tool_calls');
        });

        it('should create response with content and tool calls', () => {
            const toolCalls: ToolCall[] = [{
                id: 'call_123',
                type: 'function',
                function: { name: 'test', arguments: '{}' }
            }];
            const response = createOpenAIResponseWithTools('id', 'model', 'Thinking...', toolCalls);

            expect(response.choices[0].message.content).to.equal('Thinking...');
            expect(response.choices[0].message.tool_calls).to.have.length(1);
        });

        it('should create response without tool calls when empty', () => {
            const response = createOpenAIResponseWithTools('id', 'model', 'Hello', []);

            expect(response.choices[0].message.tool_calls).to.be.undefined;
            expect(response.choices[0].finish_reason).to.equal('stop');
        });

        it('should use provided timestamp', () => {
            const response = createOpenAIResponseWithTools('id', 'model', null, [], 12345);
            expect(response.created).to.equal(12345);
        });
    });

    describe('createStreamChunkWithTools', () => {
        it('should create chunk with tool call deltas', () => {
            const deltas = [{
                index: 0,
                id: 'call_123',
                type: 'function' as const,
                function: { name: 'get_weather', arguments: '' }
            }];
            const chunk = createStreamChunkWithTools('id', 'model', deltas);

            expect(chunk.choices[0].delta.tool_calls).to.have.length(1);
            expect(chunk.choices[0].delta.tool_calls![0].id).to.equal('call_123');
        });

        it('should create final chunk with tool_calls finish reason', () => {
            const chunk = createStreamChunkWithTools('id', 'model', [], 'tool_calls');
            expect(chunk.choices[0].finish_reason).to.equal('tool_calls');
        });

        it('should omit tool_calls when empty', () => {
            const chunk = createStreamChunkWithTools('id', 'model', []);
            expect(chunk.choices[0].delta.tool_calls).to.be.undefined;
        });
    });

    describe('filterToolsByTags', () => {
        const tools: ToolInfo[] = [
            { name: 'tool1', description: 'desc1', tags: ['web', 'search'] },
            { name: 'tool2', description: 'desc2', tags: ['file', 'read'] },
            { name: 'tool3', description: 'desc3', tags: ['web', 'file'] },
            { name: 'tool4', description: 'desc4' } // no tags
        ];

        it('should return all tools for empty tags', () => {
            const result = filterToolsByTags(tools, []);
            expect(result).to.have.length(4);
        });

        it('should filter by single tag', () => {
            const result = filterToolsByTags(tools, ['web']);
            expect(result).to.have.length(2);
            expect(result.map(t => t.name)).to.include('tool1');
            expect(result.map(t => t.name)).to.include('tool3');
        });

        it('should filter by multiple tags (AND logic)', () => {
            const result = filterToolsByTags(tools, ['web', 'search']);
            expect(result).to.have.length(1);
            expect(result[0].name).to.equal('tool1');
        });

        it('should return empty array for no matches', () => {
            const result = filterToolsByTags(tools, ['nonexistent']);
            expect(result).to.have.length(0);
        });
    });

    describe('filterToolsByName', () => {
        const tools: ToolInfo[] = [
            { name: 'get_weather', description: 'Get weather' },
            { name: 'get_time', description: 'Get time' },
            { name: 'set_reminder', description: 'Set reminder' },
            { name: 'weather_forecast', description: 'Forecast' }
        ];

        it('should return all tools for empty pattern', () => {
            const result = filterToolsByName(tools, '');
            expect(result).to.have.length(4);
        });

        it('should filter by exact name', () => {
            const result = filterToolsByName(tools, 'get_weather');
            expect(result).to.have.length(1);
            expect(result[0].name).to.equal('get_weather');
        });

        it('should filter by wildcard prefix', () => {
            const result = filterToolsByName(tools, 'get_*');
            expect(result).to.have.length(2);
        });

        it('should filter by wildcard suffix', () => {
            const result = filterToolsByName(tools, '*_weather');
            expect(result).to.have.length(1);
            expect(result[0].name).to.equal('get_weather');
        });

        it('should filter by wildcard in middle', () => {
            const result = filterToolsByName(tools, '*weather*');
            expect(result).to.have.length(2);
        });

        it('should be case insensitive', () => {
            const result = filterToolsByName(tools, 'GET_WEATHER');
            expect(result).to.have.length(1);
        });

        it('should return empty for no matches', () => {
            const result = filterToolsByName(tools, 'nonexistent');
            expect(result).to.have.length(0);
        });
    });
});
