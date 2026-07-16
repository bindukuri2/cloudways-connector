/**
 * Deployment state machine.
 *
 *   pending -> authenticating -> creating_app -> attaching_git -> pulling_git -> purging_cache -> live
 *
 * Everything funnels through `runDeployment`, which is fire-and-forget from
 * the HTTP handler's perspective; progress is persisted to the store and
 * surfaced via GET /deployments/:id.
 */
import { CloudwaysApiError } from "./cloudways/client.js";
import { createApp, findAppIdByLabel, getAppPublicUrl, waitForOperation, } from "./cloudways/apps.js";
import { purgeDeploymentCaches } from "./cloudways/cache.js";
import { startGitClone, startGitPull, } from "./cloudways/git.js";
import { getAccessToken } from "./cloudways/auth.js";
export async function runDeployment(deploymentId, req, deps) {
    const { store, cloudways, config, log } = deps;
    const serverId = req.serverId ?? config.cloudways.serverId;
    if (!serverId) {
        store.update(deploymentId, {
            state: "failed",
            message: "No Cloudways serverId available. Pass serverId in the DeployRequest or set CLOUDWAYS_SERVER_ID.",
            error: "missing serverId",
        });
        return;
    }
    const transition = (patch) => {
        const next = store.update(deploymentId, patch);
        log.info({ deploymentId, state: next.state, message: next.message }, "deploy.transition");
    };
    const recordCloudwaysOp = (kind, operationId) => {
        const ref = {
            kind,
            operationId,
            startedAt: Date.now(),
        };
        const current = store.get(deploymentId);
        const existing = current?.cloudwaysOperations ?? [];
        store.update(deploymentId, {
            cloudwaysOperations: [...existing, ref],
        });
        log.info({ deploymentId, kind, operationId }, "deploy.cloudways_op");
        return ref;
    };
    const updateCloudwaysOpStatus = (operationId, status) => {
        const current = store.get(deploymentId);
        const existing = current?.cloudwaysOperations;
        if (!existing)
            return;
        const next = existing.map((ref) => ref.operationId === operationId ? { ...ref, status } : ref);
        store.update(deploymentId, { cloudwaysOperations: next });
    };
    try {
        transition({ state: "authenticating", message: "Exchanging API key for Cloudways access token..." });
        await getAccessToken({
            apiBaseUrl: config.cloudways.apiBaseUrl,
            email: config.cloudways.email,
            apiKey: config.cloudways.apiKey,
        });
        let appId = req.existingAppId;
        // Track whether we should treat this as a re-deploy. When true we use
        // /git/pull (the "deploy code changes" endpoint) rather than /git/clone
        // (the "first-time attach remote" endpoint). This is what Cloudways'
        // dashboard "Deploy" button does.
        let isExistingApp = false;
        if (!appId) {
            // Idempotent re-deploys: if an app with this label already exists on
            // the pinned server, reuse it instead of creating a duplicate. Without
            // this, every deploy ends up creating a new Cloudways app.
            const discovered = await findAppIdByLabel(cloudways, serverId, req.appName);
            if (discovered) {
                appId = discovered;
                isExistingApp = true;
                transition({
                    state: "creating_app",
                    message: `Found existing Cloudways app "${req.appName}" (id=${discovered}); reusing it.`,
                    cloudwaysServerId: serverId,
                    cloudwaysAppId: discovered,
                });
            }
        }
        if (appId && !isExistingApp) {
            isExistingApp = true;
            transition({
                state: "creating_app",
                message: `Using existing Cloudways app (id=${appId}) on server ${serverId}...`,
                cloudwaysServerId: serverId,
                cloudwaysAppId: appId,
            });
        }
        else if (!appId) {
            transition({
                state: "creating_app",
                message: `Creating ${req.appType} app on server ${serverId}...`,
                cloudwaysServerId: serverId,
            });
            const created = await createApp(cloudways, {
                serverId: serverId,
                appLabel: req.appName,
                application: req.appType,
                appVersion: "latest",
                projectName: req.appName,
            });
            if (created.operation_id) {
                recordCloudwaysOp("create_app", created.operation_id);
                transition({
                    message: created.app_id
                        ? `App created (id=${created.app_id}). Waiting for Cloudways to finish provisioning (op ${created.operation_id})...`
                        : `Cloudways accepted app creation (op ${created.operation_id}). Waiting for provisioning...`,
                });
                await waitForOperation(cloudways, created.operation_id, {
                    intervalMs: 5_000,
                    timeoutMs: 10 * 60_000,
                    onTick: (op) => {
                        updateCloudwaysOpStatus(created.operation_id, op.status);
                        transition({ message: `Cloudways op ${created.operation_id}: ${op.status}` });
                    },
                });
            }
            appId = created.app_id;
            if (!appId) {
                appId = await findAppIdByLabel(cloudways, serverId, req.appName);
                if (!appId) {
                    throw new Error(`Cloudways finished operation but app "${req.appName}" was not found on server ${serverId}`);
                }
            }
            transition({
                cloudwaysAppId: appId,
                message: `App ready (id=${appId}).`,
            });
        }
        if (req.git.gitReady && req.git.gitUrl && req.git.branch) {
            // deploy_path is relative to the app webroot which Cloudways already
            // maps to public_html/. Passing "public_html" here would land the repo
            // in public_html/public_html/ — leave this empty.
            const deployPath = "";
            if (isExistingApp) {
                // Existing app — try /git/pull first (the "deploy" endpoint Cloudways
                // uses from its dashboard). If the remote was never attached (or the
                // pull operation itself fails), fall back to /git/clone to set it up.
                transition({
                    state: "attaching_git",
                    message: `Pulling latest from ${req.git.gitUrl}@${req.git.branch} on the existing app...`,
                });
                let pullSucceeded = false;
                try {
                    const pullOp = await startGitPull(cloudways, {
                        serverId: serverId,
                        appId,
                        branch: req.git.branch,
                        deployPath,
                    });
                    recordCloudwaysOp("git_pull", pullOp.operation_id);
                    transition({
                        state: "pulling_git",
                        message: `Pulling Git changes on Cloudways (op ${pullOp.operation_id})...`,
                    });
                    await waitForOperation(cloudways, pullOp.operation_id, {
                        intervalMs: 5_000,
                        timeoutMs: 10 * 60_000,
                        onTick: (op) => {
                            updateCloudwaysOpStatus(pullOp.operation_id, op.status);
                            transition({ message: `Cloudways git pull op ${pullOp.operation_id}: ${op.status}` });
                        },
                    });
                    pullSucceeded = true;
                }
                catch (err) {
                    const reason = err instanceof Error ? err.message : String(err);
                    transition({
                        message: `/git/pull did not work (${reason}); falling back to /git/clone to attach the remote first.`,
                    });
                }
                if (!pullSucceeded) {
                    const cloneOp = await startGitClone(cloudways, {
                        serverId: serverId,
                        appId,
                        gitUrl: req.git.gitUrl,
                        branch: req.git.branch,
                        deployPath,
                    });
                    recordCloudwaysOp("git_clone", cloneOp.operation_id);
                    transition({
                        state: "pulling_git",
                        message: `Cloning Git repository on Cloudways (op ${cloneOp.operation_id})...`,
                    });
                    await waitForOperation(cloudways, cloneOp.operation_id, {
                        intervalMs: 5_000,
                        timeoutMs: 10 * 60_000,
                        onTick: (op) => {
                            updateCloudwaysOpStatus(cloneOp.operation_id, op.status);
                            transition({ message: `Cloudways git clone op ${cloneOp.operation_id}: ${op.status}` });
                        },
                    });
                }
            }
            else {
                // Brand new app — no remote yet, so use /git/clone to attach + clone.
                transition({
                    state: "attaching_git",
                    message: `Attaching Git source ${req.git.gitUrl}@${req.git.branch}...`,
                });
                const cloneOp = await startGitClone(cloudways, {
                    serverId: serverId,
                    appId,
                    gitUrl: req.git.gitUrl,
                    branch: req.git.branch,
                    deployPath,
                });
                recordCloudwaysOp("git_clone", cloneOp.operation_id);
                transition({
                    state: "pulling_git",
                    message: `Cloning Git repository on Cloudways (op ${cloneOp.operation_id})...`,
                });
                await waitForOperation(cloudways, cloneOp.operation_id, {
                    intervalMs: 5_000,
                    timeoutMs: 10 * 60_000,
                    onTick: (op) => {
                        updateCloudwaysOpStatus(cloneOp.operation_id, op.status);
                        transition({ message: `Cloudways git clone op ${cloneOp.operation_id}: ${op.status}` });
                    },
                });
            }
        }
        transition({
            state: "purging_cache",
            message: "Purging Cloudways app cache and Varnish so the latest deploy is visible...",
        });
        const cache = await purgeDeploymentCaches(cloudways, {
            serverId: serverId,
            appId,
        });
        const cacheFailures = [
            cache.appCacheError ? `app cache: ${cache.appCacheError}` : null,
            cache.varnishError ? `varnish: ${cache.varnishError}` : null,
        ].filter(Boolean);
        transition({
            cache,
            message: cacheFailures.length > 0
                ? `Deploy finished; cache purge had warnings (${cacheFailures.join("; ")}).`
                : "Cloudways app cache and Varnish cache purged.",
        });
        const url = await getAppPublicUrl(cloudways, serverId, appId, config.cloudways.appUrlPattern);
        transition({
            state: "live",
            message: `Live at ${url}`,
            url,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const detail = err instanceof CloudwaysApiError
            ? `Cloudways HTTP ${err.status}: ${err.message}`
            : message;
        log.error({ deploymentId, err: detail }, "deploy.failed");
        try {
            store.update(deploymentId, {
                state: "failed",
                message: detail,
                error: detail,
            });
        }
        catch {
            // store may have been replaced under us; nothing meaningful to do here
        }
    }
}
//# sourceMappingURL=orchestrator.js.map