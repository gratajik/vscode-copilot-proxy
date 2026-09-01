import { expect } from 'chai';
import {
    LOOPBACK_HOST,
    MAX_TOOL_ROUNDS_CAP,
    DEFAULT_TOOL_ROUNDS,
    parseBearerToken,
    constantTimeEqual,
    isAuthExemptRoute,
    normalizeOrigin,
    isOriginAllowed,
    buildCorsHeaders,
    categorizeError,
    validateMaxToolRounds,
    isAutoExecutionAllowed
} from '../security';

describe('Security Utilities', () => {

    describe('LOOPBACK_HOST', () => {
        it('should be 127.0.0.1', () => {
            expect(LOOPBACK_HOST).to.equal('127.0.0.1');
        });
    });

    describe('parseBearerToken', () => {
        it('should extract token from valid Bearer header', () => {
            expect(parseBearerToken('Bearer abc123')).to.equal('abc123');
        });

        it('should be case-insensitive on the scheme', () => {
            expect(parseBearerToken('bearer abc123')).to.equal('abc123');
            expect(parseBearerToken('BEARER abc123')).to.equal('abc123');
        });

        it('should return null for missing header', () => {
            expect(parseBearerToken(undefined)).to.be.null;
        });

        it('should return null for empty header', () => {
            expect(parseBearerToken('')).to.be.null;
        });

        it('should return null for header without Bearer scheme', () => {
            expect(parseBearerToken('Basic abc123')).to.be.null;
        });

        it('should return null for Bearer with no token', () => {
            expect(parseBearerToken('Bearer')).to.be.null;
            expect(parseBearerToken('Bearer ')).to.be.null;
            expect(parseBearerToken('Bearer    ')).to.be.null;
        });

        it('should trim surrounding whitespace from token', () => {
            expect(parseBearerToken('Bearer   abc123  ')).to.equal('abc123');
        });

        it('should handle tokens containing internal whitespace as one token', () => {
            // Header value itself shouldn't contain spaces in a real token,
            // but ensure we don't silently truncate at first space in a
            // surprising way (regex captures everything after "Bearer ").
            expect(parseBearerToken('Bearer abc 123')).to.equal('abc 123');
        });
    });

    describe('constantTimeEqual', () => {
        it('should return true for identical strings', () => {
            expect(constantTimeEqual('secret-token', 'secret-token')).to.be.true;
        });

        it('should return false for different strings', () => {
            expect(constantTimeEqual('secret-token', 'other-token')).to.be.false;
        });

        it('should return false for different-length strings', () => {
            expect(constantTimeEqual('short', 'much-longer-string')).to.be.false;
        });

        it('should return true for two empty strings', () => {
            expect(constantTimeEqual('', '')).to.be.true;
        });

        it('should be case-sensitive', () => {
            expect(constantTimeEqual('Token', 'token')).to.be.false;
        });
    });

    describe('isAuthExemptRoute', () => {
        it('should exempt GET /health', () => {
            expect(isAuthExemptRoute('GET', '/health')).to.be.true;
        });

        it('should not exempt POST /health', () => {
            expect(isAuthExemptRoute('POST', '/health')).to.be.false;
        });

        it('should not exempt GET /', () => {
            expect(isAuthExemptRoute('GET', '/')).to.be.false;
        });

        it('should not exempt GET /v1/models', () => {
            expect(isAuthExemptRoute('GET', '/v1/models')).to.be.false;
        });

        it('should not exempt POST /v1/chat/completions', () => {
            expect(isAuthExemptRoute('POST', '/v1/chat/completions')).to.be.false;
        });
    });

    describe('normalizeOrigin', () => {
        it('should accept http://localhost:3000', () => {
            expect(normalizeOrigin('http://localhost:3000')).to.equal('http://localhost:3000');
        });

        it('should accept http://127.0.0.1:8000', () => {
            expect(normalizeOrigin('http://127.0.0.1:8000')).to.equal('http://127.0.0.1:8000');
        });

        it('should accept https://localhost (no port)', () => {
            expect(normalizeOrigin('https://localhost')).to.equal('https://localhost');
        });

        it('should accept IPv6 loopback [::1]', () => {
            expect(normalizeOrigin('http://[::1]:4000')).to.equal('http://[::1]:4000');
        });

        it('should reject non-loopback hostnames', () => {
            expect(normalizeOrigin('http://example.com')).to.be.null;
        });

        it('should reject wildcard', () => {
            expect(normalizeOrigin('*')).to.be.null;
        });

        it('should reject invalid URLs', () => {
            expect(normalizeOrigin('not a url')).to.be.null;
        });

        it('should reject origins with a path', () => {
            expect(normalizeOrigin('http://localhost:3000/app')).to.be.null;
        });

        it('should reject origins with userinfo', () => {
            expect(normalizeOrigin('http://user:pass@localhost:3000')).to.be.null;
        });

        it('should reject origins with query or hash', () => {
            expect(normalizeOrigin('http://localhost:3000?x=1')).to.be.null;
            expect(normalizeOrigin('http://localhost:3000#frag')).to.be.null;
        });

        it('should reject non-http(s) schemes', () => {
            expect(normalizeOrigin('ftp://localhost:3000')).to.be.null;
            expect(normalizeOrigin('file://localhost')).to.be.null;
        });

        it('should be case-insensitive on hostname', () => {
            expect(normalizeOrigin('http://LOCALHOST:3000')).to.equal('http://localhost:3000');
        });
    });

    describe('isOriginAllowed', () => {
        const allowlist = ['http://localhost:3000', 'http://127.0.0.1:5173'];

        it('should allow exact match in allowlist', () => {
            expect(isOriginAllowed('http://localhost:3000', allowlist)).to.be.true;
        });

        it('should reject origin not in allowlist', () => {
            expect(isOriginAllowed('http://localhost:9999', allowlist)).to.be.false;
        });

        it('should reject when allowlist is empty', () => {
            expect(isOriginAllowed('http://localhost:3000', [])).to.be.false;
        });

        it('should reject undefined origin', () => {
            expect(isOriginAllowed(undefined, allowlist)).to.be.false;
        });

        it('should reject malicious non-loopback origin even if oddly listed', () => {
            expect(isOriginAllowed('http://evil.example.com', ['http://evil.example.com'])).to.be.false;
        });

        it('should match after canonicalization (case, trailing behavior)', () => {
            expect(isOriginAllowed('http://LOCALHOST:3000', allowlist)).to.be.true;
        });
    });

    describe('buildCorsHeaders', () => {
        const allowlist = ['http://localhost:3000'];

        it('should not set Access-Control-Allow-Origin when no origin header', () => {
            const headers = buildCorsHeaders(undefined, allowlist);
            expect(headers['Access-Control-Allow-Origin']).to.be.undefined;
        });

        it('should not set Access-Control-Allow-Origin for unlisted origin', () => {
            const headers = buildCorsHeaders('http://localhost:9999', allowlist);
            expect(headers['Access-Control-Allow-Origin']).to.be.undefined;
        });

        it('should echo exact allowed origin', () => {
            const headers = buildCorsHeaders('http://localhost:3000', allowlist);
            expect(headers['Access-Control-Allow-Origin']).to.equal('http://localhost:3000');
        });

        it('should never emit a wildcard origin', () => {
            const headers = buildCorsHeaders('http://localhost:3000', allowlist);
            expect(headers['Access-Control-Allow-Origin']).to.not.equal('*');
            const headersNoOrigin = buildCorsHeaders(undefined, []);
            expect(headersNoOrigin['Access-Control-Allow-Origin']).to.not.equal('*');
        });

        it('should include Vary: Origin', () => {
            const headers = buildCorsHeaders('http://localhost:3000', allowlist);
            expect(headers['Vary']).to.equal('Origin');
        });

        it('should not allow anything when allowlist is empty (default)', () => {
            const headers = buildCorsHeaders('http://localhost:3000', []);
            expect(headers['Access-Control-Allow-Origin']).to.be.undefined;
        });
    });

    describe('categorizeError', () => {
        it('should categorize CopilotNotReadyError as service_unavailable', () => {
            class CopilotNotReadyError extends Error {
                constructor(msg: string) { super(msg); this.name = 'CopilotNotReadyError'; }
            }
            expect(categorizeError(new CopilotNotReadyError('secret-file-path-details'))).to.equal('service_unavailable');
        });

        it('should categorize unknown errors as server_error', () => {
            expect(categorizeError(new Error('some detailed message'))).to.equal('server_error');
        });

        it('should handle non-Error values', () => {
            expect(categorizeError('plain string')).to.equal('server_error');
            expect(categorizeError(null)).to.equal('server_error');
            expect(categorizeError(undefined)).to.equal('server_error');
        });

        it('should never leak the raw error message in its return value', () => {
            const secretMessage = 'API_KEY=sk-super-secret-12345 at /Users/jarklo/project/file.ts';
            const category = categorizeError(new Error(secretMessage));
            expect(category).to.not.include('sk-super-secret');
            expect(category).to.not.include('/Users/jarklo');
        });
    });

    describe('validateMaxToolRounds', () => {
        it('should return default when undefined', () => {
            expect(validateMaxToolRounds(undefined)).to.equal(DEFAULT_TOOL_ROUNDS);
        });

        it('should return default when null', () => {
            expect(validateMaxToolRounds(null)).to.equal(DEFAULT_TOOL_ROUNDS);
        });

        it('should accept a valid positive integer within cap', () => {
            expect(validateMaxToolRounds(5)).to.equal(5);
        });

        it('should accept the exact cap value', () => {
            expect(validateMaxToolRounds(MAX_TOOL_ROUNDS_CAP)).to.equal(MAX_TOOL_ROUNDS_CAP);
        });

        it('should reject 0 (no more "unlimited" semantics)', () => {
            expect(validateMaxToolRounds(0)).to.be.null;
        });

        it('should reject negative numbers', () => {
            expect(validateMaxToolRounds(-1)).to.be.null;
        });

        it('should reject fractional numbers', () => {
            expect(validateMaxToolRounds(1.5)).to.be.null;
        });

        it('should reject values above the cap', () => {
            expect(validateMaxToolRounds(MAX_TOOL_ROUNDS_CAP + 1)).to.be.null;
        });

        it('should reject non-number values', () => {
            expect(validateMaxToolRounds('5')).to.be.null;
            expect(validateMaxToolRounds({})).to.be.null;
            expect(validateMaxToolRounds([])).to.be.null;
        });

        it('should respect a custom cap argument', () => {
            expect(validateMaxToolRounds(5, 3)).to.be.null;
            expect(validateMaxToolRounds(3, 3)).to.equal(3);
        });
    });

    describe('isAutoExecutionAllowed', () => {
        it('should deny when mode is not auto', () => {
            expect(isAutoExecutionAllowed(undefined, true)).to.be.false;
            expect(isAutoExecutionAllowed('none', true)).to.be.false;
        });

        it('should deny auto mode when setting is disabled (default)', () => {
            expect(isAutoExecutionAllowed('auto', false)).to.be.false;
        });

        it('should allow auto mode only when setting is explicitly enabled', () => {
            expect(isAutoExecutionAllowed('auto', true)).to.be.true;
        });

        it('should default-deny when setting is undefined-like falsy', () => {
            expect(isAutoExecutionAllowed('auto', undefined as unknown as boolean)).to.be.false;
        });
    });
});
