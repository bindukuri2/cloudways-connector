/**
 * Discovery + server-create routes used by the picker/create flow.
 *
 * `POST /servers` is idempotent-by-label so a timed-out MCP tool call can
 * retry without spending money on a duplicate server. The in-process
 * `serverOperations` map lets the MCP `create_server` tool poll a stable
 * operation id even when Cloudways only returned the operation up-front.
 */
import { z } from "zod";
import { getOperation } from "../cloudways/apps.js";
import { createServer, findServerIdByLabel, listAppVersions, listInstanceSizes, listProviders, listRegions, listServers, } from "../cloudways/servers.js";
/**
 * Cloudways rejects labels that don't match its own rules with an opaque HTTP
 * 422. Mirror the rules here so we fail fast with a clear message before ever
 * calling the Cloudways API:
 *   - min 3, max 60 chars
 *   - lowercase alphanumeric segments separated by single dashes
 *   - no leading/trailing dash, no double dashes
 */
const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LABEL_MSG = "must be 3-60 chars, lowercase alphanumeric with single dashes as separators (e.g. 'my-wp-site')";
const createServerSchema = z
    .object({
    cloud: z.string().min(1),
    region: z.string().min(1),
    instanceType: z.string().min(1),
    application: z.enum(["wordpress", "woocommerce"]),
    appVersion: z.string().min(1).optional(),
    serverLabel: z.string().min(3).max(60).regex(LABEL_RE, `serverLabel ${LABEL_MSG}`),
    appLabel: z.string().min(3).max(60).regex(LABEL_RE, `appLabel ${LABEL_MSG}`),
    projectName: z.string().min(3).max(60).regex(LABEL_RE, `projectName ${LABEL_MSG}`).optional(),
})
    .strict();
export async function registerServerRoutes(app, deps) {
    const { cloudways } = deps;
    const serverOperations = new Map();
    app.get("/servers", async (_request, _reply) => {
        const servers = await listServers(cloudways);
        return { servers };
    });
    app.get("/providers", async () => {
        const providers = await listProviders(cloudways);
        return { providers };
    });
    app.get("/regions", async (request, reply) => {
        const cloud = request.query.cloud?.trim();
        if (!cloud) {
            reply.code(400);
            return { error: "Query param `cloud` is required (e.g. do, vultr, linode, aws, gce)." };
        }
        const regions = await listRegions(cloudways, cloud);
        return { regions };
    });
    app.get("/server_sizes", async (request, reply) => {
        const cloud = request.query.cloud?.trim();
        if (!cloud) {
            reply.code(400);
            return { error: "Query param `cloud` is required." };
        }
        const sizes = await listInstanceSizes(cloudways, cloud);
        return { sizes };
    });
    app.get("/app_versions", async (request, reply) => {
        const app = request.query.application?.trim();
        if (app !== "wordpress" && app !== "woocommerce") {
            reply.code(400);
            return {
                error: "Query param `application` is required and must be one of: wordpress, woocommerce.",
            };
        }
        const versions = await listAppVersions(cloudways, app);
        return { versions };
    });
    app.post("/servers", async (request, reply) => {
        const parsed = createServerSchema.safeParse(request.body);
        if (!parsed.success) {
            reply.code(400);
            return {
                error: "Invalid CreateServerRequest",
                issues: parsed.error.flatten(),
            };
        }
        const args = parsed.data;
        const existing = await findServerIdByLabel(cloudways, args.serverLabel);
        if (existing) {
            request.log.info({ serverLabel: args.serverLabel, serverId: existing }, "servers.create.reused");
            const resp = {
                operationId: "",
                plannedLabel: args.serverLabel,
                serverId: existing,
                reused: true,
            };
            return resp;
        }
        const created = await createServer(cloudways, args);
        const operationId = created.operation_id;
        if (operationId) {
            serverOperations.set(operationId, {
                plannedLabel: args.serverLabel,
                startedAt: Date.now(),
                serverId: created.server_id,
                completed: Boolean(created.server_id),
            });
        }
        request.log.info({ serverLabel: args.serverLabel, operationId, serverId: created.server_id }, "servers.create.started");
        const resp = {
            operationId,
            plannedLabel: args.serverLabel,
            serverId: created.server_id,
        };
        reply.code(202);
        return resp;
    });
    app.get("/servers/operations/:id", async (request, reply) => {
        const { id } = request.params;
        const pending = serverOperations.get(id);
        if (!pending) {
            // Operation may still be resolvable — try Cloudways directly.
            try {
                const op = await getOperation(cloudways, id);
                const resp = {
                    operationId: id,
                    isCompleted: op.is_completed,
                    status: op.status,
                    message: op.message,
                };
                return resp;
            }
            catch {
                reply.code(404);
                return { error: `Unknown server operation ${id}` };
            }
        }
        if (pending.completed && pending.serverId) {
            const resp = {
                operationId: id,
                isCompleted: true,
                status: pending.lastStatus ?? "Completed",
                message: pending.lastMessage,
                serverId: pending.serverId,
            };
            return resp;
        }
        const op = await getOperation(cloudways, id);
        pending.lastStatus = op.status;
        pending.lastMessage = op.message;
        if (op.is_completed) {
            // Resolve serverId by label now that Cloudways has finished provisioning.
            if (!pending.serverId) {
                pending.serverId = await findServerIdByLabel(cloudways, pending.plannedLabel);
            }
            pending.completed = true;
        }
        const resp = {
            operationId: id,
            isCompleted: op.is_completed,
            status: op.status,
            message: op.message,
            serverId: pending.serverId,
        };
        return resp;
    });
}
//# sourceMappingURL=servers.js.map