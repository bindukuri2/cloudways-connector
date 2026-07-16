/**
 * Tiny HTTP client around the local deploy-intel-api.
 *
 * The base URL is taken from DEPLOY_INTEL_API_URL (set by mcp.json),
 * defaulting to http://localhost:8787 for local dev.
 */

import type {
  DeployCreatedResponse,
  DeployRequest,
  DeployStatus,
} from "./types.js";

const DEFAULT_API_URL = "http://localhost:8787";

function apiBase(): string {
  return process.env.DEPLOY_INTEL_API_URL?.replace(/\/$/, "") ?? DEFAULT_API_URL;
}

export class DeployApiError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "DeployApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new DeployApiError(
      `Cannot reach deploy-intel-api at ${apiBase()}: ${reason}. ` +
        `Is the backend running? From the api/ directory run \`npm run dev\`.`,
    );
  }

  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status} from ${path}`) ?? `HTTP ${res.status}`;
    throw new DeployApiError(msg, res.status, body);
  }

  return body as T;
}

export const apiClient = {
  createDeployment(req: DeployRequest): Promise<DeployCreatedResponse> {
    return request<DeployCreatedResponse>("/deployments", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },
  getDeployment(id: string): Promise<DeployStatus> {
    return request<DeployStatus>(`/deployments/${encodeURIComponent(id)}`);
  },
  healthz(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/healthz");
  },
};

export function getApiBaseUrl(): string {
  return apiBase();
}
