/**
 * Integration tests for Copilot Proxy
 *
 * Prerequisites:
 * 1. Start VS Code with the extension loaded
 * 2. Ensure the Copilot Proxy server is running (default port 8080)
 * 3. Run: node test/integration.test.js
 *
 * Optional: Install openai package for OpenAI client tests
 *   npm install openai --save-dev
 */

const http = require('http');

const BASE_URL = process.env.PROXY_URL || 'http://localhost:8080';
const TIMEOUT_MS = 30000;

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

function log(message) {
    console.log(`[TEST] ${message}`);
}

function logError(message) {
    console.error(`[ERROR] ${message}`);
}

async function test(name, fn) {
    try {
        log(`Running: ${name}`);
        await fn();
        passed++;
        results.push({ name, status: 'PASS' });
        log(`  PASS: ${name}`);
    } catch (error) {
        failed++;
        results.push({ name, status: 'FAIL', error: error.message });
        logError(`  FAIL: ${name} - ${error.message}`);
    }
}

function httpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.path, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: TIMEOUT_MS
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data,
                    json: () => {
                        try {
                            return JSON.parse(data);
                        } catch {
                            return null;
                        }
                    }
                });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));

        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function streamRequest(options, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.path, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            timeout: TIMEOUT_MS
        };

        const chunks = [];
        const req = http.request(reqOptions, (res) => {
            res.on('data', chunk => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data !== '[DONE]') {
                            try {
                                chunks.push(JSON.parse(data));
                            } catch {
                                // Ignore parse errors for non-JSON data
                            }
                        }
                    }
                }
            });
            res.on('end', () => resolve({ status: res.statusCode, chunks }));
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));
        req.write(JSON.stringify(body));
        req.end();
    });
}

// Health check tests
async function testHealthEndpoint() {
    await test('GET /health returns 200', async () => {
        const res = await httpRequest({ path: '/health' });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });

    await test('GET /health returns valid JSON', async () => {
        const res = await httpRequest({ path: '/health' });
        const json = res.json();
        if (!json) throw new Error('Response is not valid JSON');
        if (json.status !== 'ok') throw new Error(`Expected status 'ok', got '${json.status}'`);
    });

    await test('GET / also returns health', async () => {
        const res = await httpRequest({ path: '/' });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
}

// Models endpoint tests
async function testModelsEndpoint() {
    await test('GET /v1/models returns 200', async () => {
        const res = await httpRequest({ path: '/v1/models' });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });

    await test('GET /v1/models returns model list', async () => {
        const res = await httpRequest({ path: '/v1/models' });
        const json = res.json();
        if (!json) throw new Error('Response is not valid JSON');
        if (json.object !== 'list') throw new Error(`Expected object 'list', got '${json.object}'`);
        if (!Array.isArray(json.data)) throw new Error('Expected data to be an array');
    });

    await test('GET /models also works (without v1 prefix)', async () => {
        const res = await httpRequest({ path: '/models' });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
}

// Chat completion tests
async function testChatCompletion() {
    await test('POST /v1/chat/completions with valid request', async () => {
        const res = await httpRequest(
            {
                path: '/v1/chat/completions',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {
                messages: [{ role: 'user', content: 'Say "test" and nothing else.' }],
                stream: false
            }
        );
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.body}`);
        const json = res.json();
        if (!json.choices || !json.choices[0]) throw new Error('Missing choices in response');
        if (!json.choices[0].message) throw new Error('Missing message in choice');
    });

    await test('POST /v1/chat/completions returns proper OpenAI format', async () => {
        const res = await httpRequest(
            {
                path: '/v1/chat/completions',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {
                messages: [{ role: 'user', content: 'Hi' }],
                stream: false
            }
        );
        const json = res.json();
        if (!json.id) throw new Error('Missing id');
        if (json.object !== 'chat.completion') throw new Error(`Expected object 'chat.completion', got '${json.object}'`);
        if (!json.created) throw new Error('Missing created timestamp');
        if (!json.model) throw new Error('Missing model');
    });

    await test('POST /chat/completions also works (without v1 prefix)', async () => {
        const res = await httpRequest(
            {
                path: '/chat/completions',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {
                messages: [{ role: 'user', content: 'Hi' }],
                stream: false
            }
        );
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
}

// Streaming tests
async function testStreamingCompletion() {
    await test('POST /v1/chat/completions with stream=true returns SSE', async () => {
        const res = await streamRequest(
            { path: '/v1/chat/completions' },
            {
                messages: [{ role: 'user', content: 'Say hello' }],
                stream: true
            }
        );
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (res.chunks.length === 0) throw new Error('No chunks received');
    });

    await test('Streaming response has proper chunk format', async () => {
        const res = await streamRequest(
            { path: '/v1/chat/completions' },
            {
                messages: [{ role: 'user', content: 'Hi' }],
                stream: true
            }
        );
        const firstChunk = res.chunks[0];
        if (!firstChunk.id) throw new Error('Missing id in chunk');
        if (firstChunk.object !== 'chat.completion.chunk') throw new Error(`Expected 'chat.completion.chunk', got '${firstChunk.object}'`);
    });

    await test('Streaming response includes role in first chunk', async () => {
        const res = await streamRequest(
            { path: '/v1/chat/completions' },
            {
                messages: [{ role: 'user', content: 'Hi' }],
                stream: true
            }
        );
        const firstChunk = res.chunks[0];
        if (!firstChunk.choices || !firstChunk.choices[0]) throw new Error('Missing choices');
        if (firstChunk.choices[0].delta.role !== 'assistant') throw new Error('First chunk should have role');
    });
}

// Error handling tests
async function testErrorHandling() {
    await test('POST with invalid JSON returns 400', async () => {
        const res = await httpRequest(
            {
                path: '/v1/chat/completions',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            'not valid json'
        );
        if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    });

    await test('Error response includes guidance field', async () => {
        const res = await httpRequest(
            {
                path: '/v1/chat/completions',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            'invalid'
        );
        const json = res.json();
        if (!json.error) throw new Error('Missing error object');
        if (!json.error.guidance) throw new Error('Missing guidance in error');
    });

    await test('Unknown endpoint returns 404', async () => {
        const res = await httpRequest({ path: '/v1/unknown' });
        if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    });
}

// CORS tests
async function testCORS() {
    await test('OPTIONS request returns CORS headers', async () => {
        const res = await httpRequest({
            path: '/v1/chat/completions',
            method: 'OPTIONS'
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (!res.headers['access-control-allow-origin']) throw new Error('Missing CORS header');
    });

    await test('Responses include Access-Control-Allow-Origin', async () => {
        const res = await httpRequest({ path: '/health' });
        if (!res.headers['access-control-allow-origin']) throw new Error('Missing CORS header');
    });
}

// System message handling
async function testSystemMessages() {
    await test('System messages are accepted and processed', async () => {
        const res = await httpRequest(
            {
                path: '/v1/chat/completions',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Hi' }
                ],
                stream: false
            }
        );
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
}

// Tool calling (stub test - should warn but not fail)
async function testToolCalling() {
    await test('Requests with tools are accepted (tools ignored)', async () => {
        const res = await httpRequest(
            {
                path: '/v1/chat/completions',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {
                messages: [{ role: 'user', content: 'Hi' }],
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'test_function',
                            description: 'A test function',
                            parameters: { type: 'object', properties: {} }
                        }
                    }
                ],
                stream: false
            }
        );
        // Should succeed (tools are logged but ignored)
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
}

// Main test runner
async function runTests() {
    log('===========================================');
    log('Copilot Proxy Integration Tests');
    log(`Target: ${BASE_URL}`);
    log('===========================================\n');

    // Check server is running
    try {
        await httpRequest({ path: '/health' });
    } catch (error) {
        logError(`Cannot connect to server at ${BASE_URL}`);
        logError('Make sure the Copilot Proxy server is running.');
        process.exit(1);
    }

    await testHealthEndpoint();
    await testModelsEndpoint();
    await testChatCompletion();
    await testStreamingCompletion();
    await testErrorHandling();
    await testCORS();
    await testSystemMessages();
    await testToolCalling();

    log('\n===========================================');
    log('Test Results');
    log('===========================================');
    log(`Passed: ${passed}`);
    log(`Failed: ${failed}`);
    log(`Total:  ${passed + failed}`);

    if (failed > 0) {
        log('\nFailed tests:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            log(`  - ${r.name}: ${r.error}`);
        });
        process.exit(1);
    }

    log('\nAll tests passed!');
    process.exit(0);
}

runTests().catch(error => {
    logError(`Test runner error: ${error.message}`);
    process.exit(1);
});
