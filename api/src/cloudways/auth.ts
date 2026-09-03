/**
 * Cloudways bearer token resolution.
 *
 * Two auth models supported:
 *
 *   1. NEW — Access Token (preferred):
 *      A long-lived scoped token generated in the Cloudways dashboard
 *      (Account -> API -> Access Tokens). Passed in as CLOUDWAYS_ACCESS_TOKEN.
 *      Used directly as the Bearer token, no exchange needed.
 *
 *   2. LEGACY — email + API key:
 *      POST /oauth/access_token with { email, api_key } returns
 *      { access_token, expires_in }. Cached in-memory and refreshed early.
 *      Deprecated by Cloudways; stops working after Oct 15, 2026.
 */

import type { CloudwaysHttpConfig } from "./client.js";

interface TokenRecord {
  token: string;
  expiresAtMs: number;
}

const REFRESH_LEEWAY_MS = 60_000;

let cached: TokenRecord | null = null;
let inFlight: Promise<string> | null = null;

export function resetTokenCache(): void {
  cached = null;
  inFlight = null;
}

export async function getAccessToken(cfg: CloudwaysHttpConfig): Promise<string> {
  // NEW auth path: pre-generated Access Token — no exchange needed.
  if (cfg.accessToken) {
    return cfg.accessToken;
  }

  // Legacy path: email + api_key -> /oauth/access_token.
  if (!cfg.email || !cfg.apiKey) {
    throw new Error(
      "No Cloudways credentials configured. Set CLOUDWAYS_ACCESS_TOKEN (recommended) " +
        "or the legacy CLOUDWAYS_EMAIL + CLOUDWAYS_API_KEY pair.",
    );
  }

  const now = Date.now();
  if (cached && cached.expiresAtMs - REFRESH_LEEWAY_MS > now) {
    return cached.token;
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = fetchLegacyToken(cfg)
    .then((rec) => {
      cached = rec;
      return rec.token;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

interface OAuthResponse {
  access_token: string;
  expires_in: number; // seconds
}

async function fetchLegacyToken(cfg: CloudwaysHttpConfig): Promise<TokenRecord> {
  const url = `${cfg.apiBaseUrl}/oauth/access_token`;
  const body = new URLSearchParams({
    email: cfg.email!,
    api_key: cfg.apiKey!,
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
    throw new Error(
      `Cloudways auth failed (HTTP ${res.status}): ${text.slice(0, 300) || "(no body)"}`,
    );
  }
  let parsed: OAuthResponse;
  try {
    parsed = JSON.parse(text) as OAuthResponse;
  } catch {
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
