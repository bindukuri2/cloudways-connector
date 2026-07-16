/**
 * Cloudways /application calls + /operation polling.
 *
 * Cloudways returns an `operation_id` for long-running tasks (app creation,
 * git clone, server restart, etc.). We poll GET /operation/{id} until
 * `is_completed=1`. The status surface mirrors Cloudways' fields verbatim.
 */

import type { CloudwaysClient } from "./client.js";

export interface CreateAppArgs {
  serverId: string;
  appLabel: string;
  /** "wordpress" or "woocommerce" — Cloudways treats WC as a WP variant. */
  application: "wordpress" | "woocommerce";
  /** e.g. "latest". Cloudways exposes the WP version label. */
  appVersion?: string;
  /** Optional human label visible in the dashboard; defaults to `appLabel`. */
  projectName?: string;
}

export interface CreateAppResponse {
  /** Present immediately for some accounts; otherwise resolved after operation completes. */
  app_id?: string;
  operation_id?: string;
  raw: unknown;
}

interface CloudwaysApplicationRecord {
  id?: string | number;
  app_id?: string | number;
  label?: string;
  cname?: string;
  app_fqdn?: string;
  application?: string;
  application_version?: string;
}

export async function createApp(
  client: CloudwaysClient,
  args: CreateAppArgs,
): Promise<CreateAppResponse> {
  const body = await client.request<Record<string, unknown>>("/app", {
    method: "POST",
    form: {
      server_id: args.serverId,
      application: args.application,
      app_version: args.appVersion ?? "latest",
      app_label: args.appLabel,
      project_name: args.projectName ?? args.appLabel,
    },
  });

  const appId = pickAppId(body);
  const operationId =
    typeof body.operation_id === "string" || typeof body.operation_id === "number"
      ? String(body.operation_id)
      : undefined;

  if (!appId && !operationId) {
    throw new Error(
      `Cloudways /app response did not contain app_id or operation_id: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }

  return { app_id: appId, operation_id: operationId, raw: body };
}

function pickAppId(body: Record<string, unknown>): string | undefined {
  if (typeof body.app_id === "string" || typeof body.app_id === "number") {
    return String(body.app_id);
  }
  if (
    body.application &&
    typeof body.application === "object" &&
    body.application !== null
  ) {
    const inner = body.application as Record<string, unknown>;
    if (typeof inner.id === "string" || typeof inner.id === "number") {
      return String(inner.id);
    }
    if (typeof inner.app_id === "string" || typeof inner.app_id === "number") {
      return String(inner.app_id);
    }
  }
  if (typeof body.id === "string" || typeof body.id === "number") {
    return String(body.id);
  }
  return undefined;
}

export interface OperationStatus {
  is_completed: boolean;
  status: "Process is in progress" | "Completed" | "Error" | string;
  message?: string;
  raw: unknown;
}

export async function getOperation(
  client: CloudwaysClient,
  operationId: string,
): Promise<OperationStatus> {
  const body = await client.request<Record<string, unknown>>(
    `/operation/${encodeURIComponent(operationId)}`,
  );
  const op = (body.operation ?? body) as Record<string, unknown>;
  // Cloudways signals successful completion with is_completed=1/"1"/true.
  // A value of -1/"-1" means the operation finished with an error — treat it
  // as completed so waitForOperation can throw rather than poll forever.
  const isCompleted =
    op.is_completed === 1 || op.is_completed === "1" || op.is_completed === true ||
    op.is_completed === -1 || op.is_completed === "-1";
  return {
    is_completed: !!isCompleted,
    status: String(op.status ?? (isCompleted ? "Completed" : "Process is in progress")),
    message: typeof op.message === "string" ? op.message : undefined,
    raw: body,
  };
}

/**
 * Poll an operation until it completes or we hit `timeoutMs`.
 * Returns the final OperationStatus. Throws if the operation reports an error
 * via the `status` field.
 */
export async function waitForOperation(
  client: CloudwaysClient,
  operationId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (s: OperationStatus) => void } = {},
): Promise<OperationStatus> {
  const interval = opts.intervalMs ?? 5_000;
  const timeout = opts.timeoutMs ?? 10 * 60_000;
  const start = Date.now();
  while (true) {
    const s = await getOperation(client, operationId);
    opts.onTick?.(s);
    if (s.is_completed) {
      if (/error|failed/i.test(s.status)) {
        throw new Error(`Cloudways operation ${operationId} failed: ${s.status} ${s.message ?? ""}`);
      }
      return s;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Cloudways operation ${operationId} timed out after ${timeout}ms`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Fetch the canonical app URL after creation. Cloudways exposes app metadata
 * via GET /server (with all applications). We scan for our app_id and pull
 * `cname` / `app_fqdn`.
 */
/** Resolve a newly created app id by label after async provisioning completes. */
export async function findAppIdByLabel(
  client: CloudwaysClient,
  serverId: string,
  appLabel: string,
): Promise<string | undefined> {
  const body = await client.request<Record<string, unknown>>(`/server/${encodeURIComponent(serverId)}`);
  const server = (body.server ?? body) as Record<string, unknown>;
  const apps = Array.isArray(server.apps) ? (server.apps as CloudwaysApplicationRecord[]) : [];
  const normalized = appLabel.trim().toLowerCase();
  const match = apps.find((a) => String(a.label ?? "").trim().toLowerCase() === normalized);
  if (!match) return undefined;
  const id = match.id ?? match.app_id;
  return id === undefined || id === null ? undefined : String(id);
}

export async function getAppPublicUrl(
  client: CloudwaysClient,
  serverId: string,
  appId: string,
  fallbackPattern: string,
): Promise<string> {
  const body = await client.request<Record<string, unknown>>(`/server/${encodeURIComponent(serverId)}`);
  const server = (body.server ?? body) as Record<string, unknown>;
  const apps = Array.isArray(server.apps) ? (server.apps as CloudwaysApplicationRecord[]) : [];
  const match = apps.find((a) => String(a.id ?? a.app_id ?? "") === String(appId));
  if (match) {
    if (match.cname && typeof match.cname === "string") return ensureHttps(match.cname);
    if (match.app_fqdn && typeof match.app_fqdn === "string") return ensureHttps(match.app_fqdn);
    if (match.label) {
      return fallbackPattern.replace("{app_label}", String(match.label));
    }
  }
  return fallbackPattern.replace("{app_label}", appId);
}

function ensureHttps(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
