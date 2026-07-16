/**
 * Centralized env-driven config. Read once at boot, fail fast on missing values.
 */

import "dotenv/config";

export interface AppConfig {
  port: number;
  host: string;
  cloudways: {
    email: string;
    apiKey: string;
    serverId: string;
    apiBaseUrl: string;
    appUrlPattern: string;
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(
      `Missing required env var ${name}. Copy api/.env.example to api/.env and fill it in.`,
    );
  }
  return v.trim();
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? "127.0.0.1",
    cloudways: {
      email: required("CLOUDWAYS_EMAIL"),
      apiKey: required("CLOUDWAYS_API_KEY"),
      serverId: required("CLOUDWAYS_SERVER_ID"),
      apiBaseUrl: (process.env.CLOUDWAYS_API_BASE_URL ?? "https://api.cloudways.com/api/v1").replace(
        /\/$/,
        "",
      ),
      appUrlPattern:
        process.env.CLOUDWAYS_APP_URL_PATTERN ?? "https://{app_label}.cloudwaysapps.com",
    },
  };
}
