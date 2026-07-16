/**
 * Cloudways /application calls + /operation polling.
 *
 * Cloudways returns an `operation_id` for long-running tasks (app creation,
 * git clone, server restart, etc.). We poll GET /operation/{id} until
 * `is_completed=1`. The status surface mirrors Cloudways' fields verbatim.
 */
export async function createApp(client, args) {
    const body = await client.request("/app", {
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
    const operationId = typeof body.operation_id === "string" || typeof body.operation_id === "number"
        ? String(body.operation_id)
        : undefined;
    if (!appId && !operationId) {
        throw new Error(`Cloudways /app response did not contain app_id or operation_id: ${JSON.stringify(body).slice(0, 300)}`);
    }
    return { app_id: appId, operation_id: operationId, raw: body };
}
function pickAppId(body) {
    if (typeof body.app_id === "string" || typeof body.app_id === "number") {
        return String(body.app_id);
    }
    if (body.application &&
        typeof body.application === "object" &&
        body.application !== null) {
        const inner = body.application;
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
export async function getOperation(client, operationId) {
    const body = await client.request(`/operation/${encodeURIComponent(operationId)}`);
    const op = (body.operation ?? body);
    // Cloudways signals successful completion with is_completed=1/"1"/true.
    // A value of -1/"-1" means the operation finished with an error — treat it
    // as completed so waitForOperation can throw rather than poll forever.
    const isCompleted = op.is_completed === 1 || op.is_completed === "1" || op.is_completed === true ||
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
export async function waitForOperation(client, operationId, opts = {}) {
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
 * Cloudways exposes server + app metadata via GET /server (list). The
 * per-server path (/server/{id}) is not a valid JSON endpoint on this API.
 */
async function getServerApps(client, serverId) {
    const body = await client.request("/server");
    const servers = Array.isArray(body.servers)
        ? body.servers
        : [];
    const server = servers.find((s) => String(s.id ?? "") === String(serverId));
    if (!server)
        return [];
    return Array.isArray(server.apps) ? server.apps : [];
}
/** Resolve a newly created app id by label after async provisioning completes. */
export async function findAppIdByLabel(client, serverId, appLabel) {
    const apps = await getServerApps(client, serverId);
    const normalized = appLabel.trim().toLowerCase();
    const match = apps.find((a) => String(a.label ?? "").trim().toLowerCase() === normalized);
    if (!match)
        return undefined;
    const id = match.id ?? match.app_id;
    return id === undefined || id === null ? undefined : String(id);
}
export async function getAppPublicUrl(client, serverId, appId, fallbackPattern) {
    const apps = await getServerApps(client, serverId);
    const match = apps.find((a) => String(a.id ?? a.app_id ?? "") === String(appId));
    if (match) {
        if (match.cname && typeof match.cname === "string")
            return ensureHttps(match.cname);
        if (match.app_fqdn && typeof match.app_fqdn === "string")
            return ensureHttps(match.app_fqdn);
        if (match.label) {
            return fallbackPattern.replace("{app_label}", String(match.label));
        }
    }
    return fallbackPattern.replace("{app_label}", appId);
}
function ensureHttps(url) {
    if (/^https?:\/\//i.test(url))
        return url;
    return `https://${url}`;
}
//# sourceMappingURL=apps.js.map