/**
 * Cloudways server + reference-data endpoints.
 *
 * Mirrors what the community/official Cloudways MCP servers expose so the
 * plugin can drive an LLM-first "list -> pick / create" flow using only an
 * API key. Everything here is a thin normalizer over the Cloudways Platform
 * API — no state, no polling; polling is done via the existing
 * `waitForOperation` helper in ./apps.ts.
 *
 * Response shapes vary slightly across Cloudways API versions; the parsers
 * below are defensive so a shape change doesn't break the plugin.
 */
export async function listServers(client) {
    const body = await client.request("/server");
    const raw = pickArray(body, ["servers"]) ?? [];
    return raw
        .map((r) => normalizeServer(r))
        .filter((s) => s !== null);
}
export async function getServer(client, serverId) {
    const body = await client.request(`/server/${encodeURIComponent(serverId)}`);
    const raw = (body.server ?? body);
    return normalizeServer(raw);
}
/**
 * Idempotency helper for `POST /server`. Cloudways doesn't dedupe on label,
 * so we do it: if a server with `serverLabel` already exists we reuse it
 * instead of spinning up (and billing for) a second one on retry.
 */
export async function findServerIdByLabel(client, serverLabel) {
    const wanted = serverLabel.trim().toLowerCase();
    if (!wanted)
        return undefined;
    const servers = await listServers(client);
    const match = servers.find((s) => s.label.trim().toLowerCase() === wanted);
    return match?.id;
}
export async function listProviders(client) {
    const body = await client.request("/providers");
    const raw = pickArray(body, ["providers"]) ?? [];
    return raw
        .map((r) => {
        const obj = r;
        const code = pickString(obj, ["id", "code", "cloud"]);
        const name = pickString(obj, ["name", "label"]) ?? code;
        if (!code || !name)
            return null;
        return { code, name };
    })
        .filter((p) => p !== null);
}
export async function listRegions(client, cloud) {
    const body = await client.request("/regions");
    const container = (body.regions ?? body);
    // Cloudways returns either a flat array (older) or a { cloud: [...] } map (newer).
    let raw = [];
    if (Array.isArray(container)) {
        raw = container;
    }
    else if (container && typeof container === "object") {
        const map = container;
        const bucket = map[cloud];
        if (Array.isArray(bucket))
            raw = bucket;
    }
    const out = [];
    for (const r of raw) {
        const obj = r;
        const code = pickString(obj, ["id", "code", "region"]);
        const name = pickString(obj, ["name", "label"]) ?? code;
        if (!code || !name)
            continue;
        const objCloud = pickString(obj, ["cloud", "provider"]) ?? cloud;
        if (objCloud && objCloud !== cloud && !Array.isArray(container))
            continue;
        out.push({ code, name, cloud });
    }
    return out;
}
export async function listInstanceSizes(client, cloud) {
    const body = await client.request("/server_sizes");
    const container = (body.sizes ?? body.server_sizes ?? body);
    let raw = [];
    if (Array.isArray(container)) {
        raw = container;
    }
    else if (container && typeof container === "object") {
        const map = container;
        const bucket = map[cloud];
        if (Array.isArray(bucket))
            raw = bucket;
    }
    const out = [];
    for (const r of raw) {
        // Cloudways sometimes returns bare strings ("1gb"), sometimes objects.
        if (typeof r === "string") {
            out.push({ code: r, cloud });
            continue;
        }
        if (!r || typeof r !== "object")
            continue;
        const obj = r;
        const code = pickString(obj, ["id", "code", "size", "instance_type", "name"]);
        if (!code)
            continue;
        out.push({
            code,
            cloud,
            ram: pickString(obj, ["ram", "memory"]),
            cpu: pickString(obj, ["cpu", "vcpu", "cpus"]),
            disk: pickString(obj, ["disk", "storage"]),
            priceMonthly: pickString(obj, ["price", "price_monthly", "monthly"]),
        });
    }
    return out;
}
export async function listAppVersions(client, application) {
    const body = await client.request("/app_version");
    const container = (body.app_versions ?? body.versions ?? body);
    let raw = [];
    if (Array.isArray(container)) {
        raw = container;
    }
    else if (container && typeof container === "object") {
        const map = container;
        const bucket = map[application];
        if (Array.isArray(bucket))
            raw = bucket;
        else if (bucket && typeof bucket === "object") {
            // Shape: { wordpress: { "6.5": { is_default: true }, ... } }
            for (const [version, meta] of Object.entries(bucket)) {
                raw.push({ version, ...(meta && typeof meta === "object" ? meta : {}) });
            }
        }
    }
    const out = [];
    for (const r of raw) {
        if (typeof r === "string") {
            out.push({ application, version: r });
            continue;
        }
        if (!r || typeof r !== "object")
            continue;
        const obj = r;
        const version = pickString(obj, ["version", "app_version", "id"]);
        if (!version)
            continue;
        const isDefault = obj.is_default === true || obj.is_default === 1 || obj.is_default === "1";
        out.push({ application, version, isDefault });
    }
    return out;
}
export async function createServer(client, args) {
    const body = await client.request("/server", {
        method: "POST",
        form: {
            cloud: args.cloud,
            region: args.region,
            instance_type: args.instanceType,
            application: args.application,
            app_version: args.appVersion ?? "latest",
            server_label: args.serverLabel,
            app_label: args.appLabel,
            project_name: args.projectName ?? args.appLabel,
        },
    });
    const operationId = typeof body.operation_id === "string" || typeof body.operation_id === "number"
        ? String(body.operation_id)
        : undefined;
    const serverId = pickServerId(body);
    if (!operationId && !serverId) {
        throw new Error(`Cloudways POST /server did not return operation_id or server id: ${JSON.stringify(body).slice(0, 300)}`);
    }
    return { operation_id: operationId ?? "", server_id: serverId, raw: body };
}
function normalizeServer(raw) {
    const id = pickString(raw, ["id", "server_id"]);
    if (!id)
        return null;
    const label = pickString(raw, ["label", "name"]) ?? id;
    const cloud = pickString(raw, ["cloud", "provider"]) ?? "";
    const region = pickString(raw, ["region"]) ?? "";
    const size = pickString(raw, ["size", "server_size", "instance_type"]) ?? "";
    const status = pickString(raw, ["status", "state"]) ?? "";
    const publicIp = pickString(raw, ["public_ip", "ip"]);
    const rawApps = Array.isArray(raw.apps) ? raw.apps : [];
    const apps = [];
    for (const a of rawApps) {
        if (!a || typeof a !== "object")
            continue;
        const app = a;
        const appId = pickString(app, ["id", "app_id"]);
        if (!appId)
            continue;
        apps.push({
            id: appId,
            label: pickString(app, ["label", "name"]) ?? appId,
            application: pickString(app, ["application"]),
        });
    }
    return {
        id,
        label,
        cloud,
        region,
        size,
        status,
        publicIp,
        appsCount: apps.length,
        apps,
    };
}
function pickServerId(body) {
    const direct = pickString(body, ["server_id"]);
    if (direct)
        return direct;
    const server = body.server;
    if (server && typeof server === "object") {
        return pickString(server, ["id", "server_id"]);
    }
    return undefined;
}
function pickString(obj, keys) {
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === "string" && v.length > 0)
            return v;
        if (typeof v === "number")
            return String(v);
    }
    return undefined;
}
function pickArray(obj, keys) {
    for (const k of keys) {
        const v = obj[k];
        if (Array.isArray(v))
            return v;
    }
    return undefined;
}
//# sourceMappingURL=servers.js.map