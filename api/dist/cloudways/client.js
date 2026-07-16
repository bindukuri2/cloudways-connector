/**
 * Authenticated HTTP client for the Cloudways Platform API.
 *
 * - Bearer token injected from auth.ts (cached, auto-refreshed on 401).
 * - JSON encoding for POST/PUT, form-encoding optional for endpoints that need it.
 * - Lightweight retry on 429 / 5xx with exponential backoff (3 attempts total).
 */
import { getAccessToken, resetTokenCache } from "./auth.js";
export class CloudwaysApiError extends Error {
    status;
    body;
    constructor(status, message, body) {
        super(message);
        this.name = "CloudwaysApiError";
        this.status = status;
        this.body = body;
    }
}
export function createCloudwaysClient(cfg) {
    return {
        request: (path, opts) => request(cfg, path, opts),
    };
}
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
async function request(cfg, path, opts = {}) {
    const method = opts.method ?? "GET";
    const search = opts.query ? "?" + buildQuery(opts.query) : "";
    const url = `${cfg.apiBaseUrl}${path}${search}`;
    let attempt = 0;
    while (true) {
        attempt++;
        const token = await getAccessToken(cfg);
        const headers = {
            authorization: `Bearer ${token}`,
            accept: "application/json",
        };
        let body;
        if (opts.form) {
            headers["content-type"] = "application/x-www-form-urlencoded";
            body = coerceForm(opts.form);
        }
        else if (opts.json) {
            headers["content-type"] = "application/json";
            body = JSON.stringify(opts.json);
        }
        const res = await fetch(url, { method, headers, body });
        const text = await res.text();
        const parsed = parseMaybeJson(text);
        if (res.ok)
            return parsed;
        // 401 -> refresh the token once and retry the same attempt
        if (res.status === 401 && attempt === 1) {
            resetTokenCache();
            continue;
        }
        if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
            await sleep(backoffMs(attempt));
            continue;
        }
        const msg = extractErrorMessage(parsed) ?? `HTTP ${res.status} from ${method} ${path}`;
        throw new CloudwaysApiError(res.status, msg, parsed);
    }
}
function coerceForm(form) {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
        if (v === undefined)
            continue;
        out.append(k, String(v));
    }
    return out;
}
function buildQuery(q) {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
        if (v === undefined)
            continue;
        out.append(k, String(v));
    }
    return out.toString();
}
function parseMaybeJson(text) {
    if (!text)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function extractErrorMessage(body) {
    if (!body || typeof body !== "object")
        return null;
    const b = body;
    if (typeof b.error_description === "string")
        return b.error_description;
    if (typeof b.message === "string")
        return b.message;
    if (typeof b.error === "string")
        return b.error;
    if (b.error && typeof b.error === "object") {
        const inner = b.error;
        if (typeof inner.message === "string")
            return inner.message;
    }
    return null;
}
function backoffMs(attempt) {
    // 250ms, 750ms, 2250ms ...
    return 250 * Math.pow(3, attempt - 1);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=client.js.map