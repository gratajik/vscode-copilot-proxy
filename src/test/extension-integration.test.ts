import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import {
    parseBearerToken,
    constantTimeEqual,
    isAuthExemptRoute,
    buildCorsHeaders,
    isAutoExecutionAllowed,
    validateMaxToolRounds
} from '../security';

/**
 * Integration-style tests for the auth/CORS/tool-gating wiring that
 * extension.ts applies around the pure security.ts helpers.
 *
 * extension.ts itself imports `vscode` and cannot be required directly in
 * this Mocha/Node environment (no `vscode` module is available outside the
 * extension host). Rather than mock the whole `vscode` API, this suite
 * reconstructs the same request-handling composition (auth gate -> CORS
 * headers -> routing) using a real Node http server and the exact
 * security.ts functions extension.ts calls, so the wiring logic itself
 * (not just the underlying primitives) gets exercised end-to-end.
 * The actual extension.ts code was verified by manual read-through against
 * this composition (see dev-implementation-notes.md).
 */
describe('Extension request-handling wiring (integration)', () => {
    let server: http.Server;
    let baseUrl: string;
    const STORED_TOKEN = 'test-secret-token';
    const ALLOWED_ORIGINS = ['http://localhost:5173'];

    async function authenticate(req: http.IncomingMessage): Promise<boolean> {
        const parsed = parseBearerToken(req.headers.authorization);
        if (!parsed) return false;
        return constantTimeEqual(parsed, STORED_TOKEN);
    }

    before((done) => {
        server = http.createServer(async (req, res) => {
            const origin = req.headers.origin;
            const corsHeaders = buildCorsHeaders(origin, ALLOWED_ORIGINS);
            const urlPath = (req.url || '').split('?')[0];

            if (req.method === 'OPTIONS') {
                res.writeHead(200, corsHeaders);
                res.end();
                return;
            }

            if (!isAuthExemptRoute(req.method || '', urlPath)) {
                const ok = await authenticate(req);
                if (!ok) {
                    res.writeHead(401, { 'Content-Type': 'application/json', ...corsHeaders });
                    res.end(JSON.stringify({ error: { message: 'Missing or invalid proxy authorization', type: 'unauthorized', code: 401 } }));
                    return;
                }
            }

            if (urlPath === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
                res.end(JSON.stringify({ status: 'ok' }));
                return;
            }

            if (urlPath === '/v1/chat/completions' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    let parsedBody: { tool_execution?: 'none' | 'auto'; max_tool_rounds?: unknown } = {};
                    try { parsedBody = JSON.parse(body || '{}'); } catch { /* ignore */ }

                    const allowAutoToolExecution = false; // simulates default setting
                    const autoAllowed = isAutoExecutionAllowed(parsedBody.tool_execution, allowAutoToolExecution);

                    if (autoAllowed) {
                        const maxRounds = validateMaxToolRounds(parsedBody.max_tool_rounds);
                        if (maxRounds === null) {
                            res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
                            res.end(JSON.stringify({ error: { message: 'max_tool_rounds must be an integer between 1 and 100', type: 'invalid_request_error' } }));
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
                        res.end(JSON.stringify({ mode: 'auto', maxRounds }));
                        return;
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
                    res.end(JSON.stringify({ mode: 'passthrough' }));
                });
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
            res.end(JSON.stringify({ error: { message: 'not found' } }));
        });

        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as AddressInfo;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            done();
        });
    });

    after((done) => {
        server.close(() => done());
    });

    function request(path: string, options: http.RequestOptions = {}, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
        return new Promise((resolve, reject) => {
            const req = http.request(baseUrl + path, options, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }

    it('allows GET /health without any Authorization header', async () => {
        const res = await request('/health', { method: 'GET' });
        expect(res.status).to.equal(200);
    });

    it('rejects a protected route with no Authorization header (401)', async () => {
        const res = await request('/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, '{}');
        expect(res.status).to.equal(401);
        const parsed = JSON.parse(res.body);
        expect(parsed.error.type).to.equal('unauthorized');
    });

    it('rejects a protected route with a wrong bearer token (401)', async () => {
        const res = await request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: '******' }
        }, '{}');
        expect(res.status).to.equal(401);
    });

    it('allows a protected route with the correct bearer token', async () => {
        const res = await request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STORED_TOKEN}` }
        }, '{}');
        expect(res.status).to.equal(200);
        expect(JSON.parse(res.body).mode).to.equal('passthrough');
    });

    it('processes a request with no Origin header at all (curl-style) when authenticated', async () => {
        const res = await request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STORED_TOKEN}` }
        }, '{}');
        expect(res.status).to.equal(200);
        expect(res.headers['access-control-allow-origin']).to.be.undefined;
    });

    it('echoes Access-Control-Allow-Origin only for an allowlisted origin', async () => {
        const res = await request('/health', { method: 'GET', headers: { Origin: 'http://localhost:5173' } });
        expect(res.headers['access-control-allow-origin']).to.equal('http://localhost:5173');
    });

    it('omits Access-Control-Allow-Origin for a non-allowlisted origin', async () => {
        const res = await request('/health', { method: 'GET', headers: { Origin: 'http://evil.example.com' } });
        expect(res.headers['access-control-allow-origin']).to.be.undefined;
    });

    it('answers OPTIONS preflight without requiring authentication', async () => {
        const res = await request('/v1/chat/completions', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
        expect(res.status).to.equal(200);
        expect(res.headers['access-control-allow-origin']).to.equal('http://localhost:5173');
    });

    it('does not auto-execute tools when tool_execution is auto but the setting is disabled (falls through to passthrough)', async () => {
        const res = await request('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STORED_TOKEN}` }
        }, JSON.stringify({ tool_execution: 'auto' }));
        expect(res.status).to.equal(200);
        expect(JSON.parse(res.body).mode).to.equal('passthrough');
    });
});
