/**
 * Tiny HTTP client around the local deploy-intel-api.
 *
 * The base URL is taken from DEPLOY_INTEL_API_URL (set by mcp.json),
 * defaulting to http://localhost:8787 for local dev.
 */
const DEFAULT_API_URL = "http://localhost:8787";
function apiBase() {
    return process.env.DEPLOY_INTEL_API_URL?.replace(/\/$/, "") ?? DEFAULT_API_URL;
}
export class DeployApiError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.name = "DeployApiError";
        this.status = status;
        this.body = body;
    }
}
async function request(path, init) {
    const url = `${apiBase()}${path}`;
    let res;
    try {
        res = await fetch(url, {
            ...init,
            headers: {
                "content-type": "application/json",
                accept: "application/json",
                ...(init?.headers ?? {}),
            },
        });
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new DeployApiError(`Cannot reach deploy-intel-api at ${apiBase()}: ${reason}. ` +
            `Is the backend running? From the api/ directory run \`npm run dev\`.`);
    }
    const text = await res.text();
    let body = undefined;
    if (text) {
        try {
            body = JSON.parse(text);
        }
        catch {
            body = text;
        }
    }
    if (!res.ok) {
        const msg = (body && typeof body === "object" && "error" in body
            ? String(body.error)
            : `HTTP ${res.status} from ${path}`) ?? `HTTP ${res.status}`;
        throw new DeployApiError(msg, res.status, body);
    }
    return body;
}
export const apiClient = {
    createDeployment(req) {
        return request("/deployments", {
            method: "POST",
            body: JSON.stringify(req),
        });
    },
    getDeployment(id) {
        return request(`/deployments/${encodeURIComponent(id)}`);
    },
    healthz() {
        return request("/healthz");
    },
};
export function getApiBaseUrl() {
    return apiBase();
}
//# sourceMappingURL=client.js.map