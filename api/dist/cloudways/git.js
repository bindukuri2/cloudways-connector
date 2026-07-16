/**
 * Cloudways Git endpoints.
 *
 *   POST /git/clone  -> attach a remote to the app AND clone it for the first
 *                       time. Required fields include `git_url`.
 *   POST /git/pull   -> pull the latest changes from the already-configured
 *                       remote. No `git_url` field (Cloudways uses the one set
 *                       at clone time). This is the "deploy code changes"
 *                       endpoint and is what we want for repeat deploys.
 *
 * Both return `{ status: true, operation_id: <int> }` which we then poll via
 * GET /operation/{id} until `is_completed=1`.
 *
 * POC scope: repo is assumed to be reachable (public, or deploy key already
 * configured via the Cloudways dashboard).
 */
/** Cloudways /git/clone expects SSH remotes, e.g. git@github.com:owner/repo.git */
export function normalizeGitUrlForCloudways(url) {
    const trimmed = url.trim();
    const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
    if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
        return `git@${httpsMatch[1]}:${httpsMatch[2]}.git`;
    }
    const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/);
    if (sshMatch && sshMatch[1] && sshMatch[2]) {
        return `git@${sshMatch[1]}:${sshMatch[2]}.git`;
    }
    return trimmed;
}
export async function startGitClone(client, args) {
    const body = await client.request("/git/clone", {
        method: "POST",
        form: {
            server_id: args.serverId,
            app_id: args.appId,
            git_url: normalizeGitUrlForCloudways(args.gitUrl),
            branch_name: args.branch,
            deploy_path: args.deployPath ?? "",
        },
    });
    return parseOperationResponse(body, "/git/clone");
}
/**
 * Pull the latest changes from the remote that was previously configured via
 * /git/clone. This is the right endpoint for "deploy code changes to an
 * already-set-up app" — it is the same action as clicking "Deploy" in the
 * Cloudways dashboard's Git tab. No `git_url` is sent because Cloudways
 * reuses the one set at clone time.
 */
export async function startGitPull(client, args) {
    const body = await client.request("/git/pull", {
        method: "POST",
        form: {
            server_id: args.serverId,
            app_id: args.appId,
            branch_name: args.branch,
            deploy_path: args.deployPath ?? "",
        },
    });
    return parseOperationResponse(body, "/git/pull");
}
function parseOperationResponse(body, path) {
    const operationId = typeof body.operation_id === "string" || typeof body.operation_id === "number"
        ? String(body.operation_id)
        : undefined;
    if (!operationId) {
        throw new Error(`Cloudways ${path} response did not contain operation_id: ${JSON.stringify(body).slice(0, 300)}`);
    }
    return { operation_id: operationId, raw: body };
}
//# sourceMappingURL=git.js.map