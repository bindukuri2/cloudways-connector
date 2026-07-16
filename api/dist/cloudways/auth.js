/**
 * Cloudways OAuth bearer token cache.
 *
 * Cloudways docs: POST /oauth/access_token with { email, api_key } returns
 * { access_token, expires_in }. We cache in-memory and refresh slightly early.
 */
const REFRESH_LEEWAY_MS = 60_000;
let cached = null;
let inFlight = null;
export function resetTokenCache() {
    cached = null;
    inFlight = null;
}
export async function getAccessToken(cfg) {
    const now = Date.now();
    if (cached && cached.expiresAtMs - REFRESH_LEEWAY_MS > now) {
        return cached.token;
    }
    if (inFlight) {
        return inFlight;
    }
    inFlight = fetchToken(cfg)
        .then((rec) => {
        cached = rec;
        return rec.token;
    })
        .finally(() => {
        inFlight = null;
    });
    return inFlight;
}
async function fetchToken(cfg) {
    const url = `${cfg.apiBaseUrl}/oauth/access_token`;
    const body = new URLSearchParams({
        email: cfg.email,
        api_key: cfg.apiKey,
    });
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
        },
        body,
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Cloudways auth failed (HTTP ${res.status}): ${text.slice(0, 300) || "(no body)"}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(`Cloudways auth returned non-JSON body: ${text.slice(0, 300)}`);
    }
    if (!parsed.access_token) {
        throw new Error("Cloudways auth response did not include access_token");
    }
    const expiresInMs = (parsed.expires_in ?? 3600) * 1000;
    return {
        token: parsed.access_token,
        expiresAtMs: Date.now() + expiresInMs,
    };
}
//# sourceMappingURL=auth.js.map