/**
 * Security utilities for the Copilot Proxy extension.
 * Pure functions (no `vscode` import) so they can be unit tested directly,
 * following the same pattern as core.ts.
 *
 * @see docs/features/security-hardening/design.md - Security features
 */

import { createHash, timingSafeEqual } from 'crypto';

/**
 * The only host the HTTP server is ever allowed to bind to.
 * Not configurable - there is no setting that can widen this.
 */
export const LOOPBACK_HOST = '127.0.0.1';

/**
 * Hard upper bound on tool auto-execution rounds, regardless of what a
 * request or setting asks for. Prevents unbounded/runaway tool loops.
 */
export const MAX_TOOL_ROUNDS_CAP = 100;

/**
 * Default number of auto-execute rounds when the request omits max_tool_rounds.
 * Mirrors core.ts DEFAULT_MAX_TOOL_ROUNDS (kept in sync manually - both are
 * small stable constants unlikely to drift).
 */
export const DEFAULT_TOOL_ROUNDS = 10;

/**
 * Extracts the bearer token from an Authorization header value.
 * Returns null if the header is missing, malformed, or the token is empty.
 * Never logs or echoes the header/token - callers must not log the result.
 */
export function parseBearerToken(header: string | undefined): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    const token = match[1].trim();
    return token.length > 0 ? token : null;
}

/**
 * Constant-time string comparison to avoid leaking token length/content via
 * timing side-channels. Hashes both inputs to a fixed-length digest first so
 * `timingSafeEqual` (which requires equal-length buffers) always succeeds
 * without branching on input length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
    const digestA = createHash('sha256').update(a, 'utf8').digest();
    const digestB = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(digestA, digestB);
}

/**
 * Routes that are reachable without proxy authentication.
 * Only the health check - it reveals no prompt data, models, or credentials.
 */
export function isAuthExemptRoute(method: string, path: string): boolean {
    return method === 'GET' && path === '/health';
}

/**
 * Validates and canonicalizes an Origin header value for the CORS allowlist.
 * Only accepts http/https schemes with a loopback hostname, no path,
 * no userinfo, no wildcard. Returns null if the origin is not a valid,
 * canonical loopback origin.
 */
export function normalizeOrigin(origin: string): string | null {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    if (url.search || url.hash) return null;

    const hostname = url.hostname.toLowerCase();
    const isLoopbackHost =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '[::1]';
    if (!isLoopbackHost) return null;

    // Reconstruct a canonical form: scheme://host[:port] with no trailing slash.
    const portPart = url.port ? `:${url.port}` : '';
    const hostForUrl = hostname === '::1' ? '[::1]' : hostname;
    return `${url.protocol}//${hostForUrl}${portPart}`;
}

/**
 * Checks whether the given request Origin is present in the configured
 * allowlist. Requires an exact match after canonicalizing both sides.
 * No wildcard support - an empty/unset allowlist allows nothing.
 */
export function isOriginAllowed(origin: string | undefined, allowlist: string[]): boolean {
    if (!origin) return false;
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return false;
    return allowlist.some(entry => normalizeOrigin(entry) === normalizedOrigin);
}

/**
 * Builds CORS headers for a request given the configured origin allowlist.
 * Never emits a wildcard Access-Control-Allow-Origin. Only echoes the exact
 * request Origin when it is present in the allowlist; otherwise omits
 * Access-Control-Allow-Origin entirely (browsers will then block the response).
 */
export function buildCorsHeaders(origin: string | undefined, allowlist: string[]): Record<string, string> {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };

    if (isOriginAllowed(origin, allowlist)) {
        headers['Access-Control-Allow-Origin'] = origin as string;
    }

    return headers;
}

/**
 * Small, fixed set of error categories safe to log. Never includes the raw
 * error message, file paths, or stack traces - only a coarse classification.
 */
export type ErrorCategory =
    | 'timeout'
    | 'validation_error'
    | 'service_unavailable'
    | 'auth_error'
    | 'forbidden'
    | 'not_found'
    | 'server_error';

/**
 * Categorizes an error into a small fixed set of labels for metadata-only
 * logging. Never returns or derives from the raw error message content.
 */
export function categorizeError(error: unknown): ErrorCategory {
    if (error && typeof error === 'object' && 'name' in error) {
        const name = String((error as { name?: unknown }).name ?? '');
        if (name === 'CopilotNotReadyError') return 'service_unavailable';
    }
    // Fall back to a generic bucket - message content is intentionally not
    // inspected here to avoid depending on (and thus encouraging logging of)
    // error message text elsewhere.
    return 'server_error';
}

/**
 * Validates a requested max_tool_rounds value against the hard cap.
 * Returns the effective round count, or null if the value is invalid
 * (not a positive integer, or exceeds the cap).
 * `undefined` maps to the default round count.
 */
export function validateMaxToolRounds(value: unknown, cap: number = MAX_TOOL_ROUNDS_CAP): number | null {
    if (value === undefined || value === null) return DEFAULT_TOOL_ROUNDS;
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < 1 || value > cap) return null;
    return value;
}

/**
 * Central policy gate for server-side (auto-execute) tool invocation.
 * A request can never enable auto-execution on its own - the extension
 * setting must be explicitly true.
 */
export function isAutoExecutionAllowed(
    requestedMode: 'none' | 'auto' | undefined,
    settingEnabled: boolean
): boolean {
    if (requestedMode !== 'auto') return false;
    return settingEnabled === true;
}
