/**
 * Centralized env-driven config. Read once at boot, fail fast on missing values.
 */

import "dotenv/config";

export interface AppConfig {
  port: number;
  host: string;
  cloudways: {
    /**
     * New auth model (preferred): a pre-generated Access Token from the
     * Cloudways dashboard (Account -> API -> Access Tokens). When set, we
     * skip the /oauth/access_token exchange and use this value directly as
     * the Bearer token. Legacy API keys stop working after Oct 15, 2026.
     */
    accessToken?: string;
    /** Legacy: account email used with the deprecated /oauth/access_token flow. */
    email?: string;
    /** Legacy: API key used with the deprecated /oauth/access_token flow. */
    apiKey?: string;
    /**
     * Optional fallback server id. Only used when the DeployRequest didn't
     * carry one — normal operation is that the plugin resolves the server via
     * the picker/create flow and passes it in.
     */
    serverId?: string;
    apiBaseUrl: string;
    appUrlPattern: string;
  };
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  if (!v || v.trim().length === 0) return undefined;
  return v.trim();
}

export function loadConfig(): AppConfig {
  const accessToken = optional("CLOUDWAYS_ACCESS_TOKEN");
  const email = optional("CLOUDWAYS_EMAIL");
  const apiKey = optional("CLOUDWAYS_API_KEY");

  if (!accessToken && !(email && apiKey)) {
    throw new Error(
      "Missing Cloudways credentials. Set CLOUDWAYS_ACCESS_TOKEN (recommended — " +
        "generate from https://platform.cloudways.com/api under Access Tokens) " +
        "or the legacy CLOUDWAYS_EMAIL + CLOUDWAYS_API_KEY pair (deprecated, " +
        "stops working after Oct 15, 2026). Copy api/.env.example to api/.env and fill it in.",
    );
  }

  return {
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? "127.0.0.1",
    cloudways: {
      accessToken,
      email,
      apiKey,
      serverId: optional("CLOUDWAYS_SERVER_ID"),
      apiBaseUrl: (process.env.CLOUDWAYS_API_BASE_URL ?? "https://api.cloudways.com/api/v1").replace(
        /\/$/,
        "",
      ),
      appUrlPattern:
        process.env.CLOUDWAYS_APP_URL_PATTERN ?? "https://{app_label}.cloudwaysapps.com",
    },
  };
}
