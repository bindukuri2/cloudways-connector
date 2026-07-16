import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runDeployment } from "../orchestrator.js";
const projectStackSchema = z
    .object({
    framework: z.enum(["wordpress", "wordpress-bedrock", "static-landing", "unknown"]),
    hasWooCommerce: z.boolean(),
    phpVersion: z.string(),
    theme: z.object({ name: z.string(), slug: z.string() }).optional(),
    plugins: z.array(z.object({ slug: z.string(), name: z.string().optional() })).default([]),
    evidence: z.array(z.object({ signal: z.string(), path: z.string() })).default([]),
    workspaceRoot: z.string(),
})
    .strict();
const gitSourceSchema = z
    .object({
    gitReady: z.boolean(),
    gitUrl: z.string().optional(),
    branch: z.string().optional(),
    dirty: z.boolean().optional(),
    reason: z.string().optional(),
})
    .strict();
const envVarSchema = z
    .object({
    key: z.string(),
    value: z.string().optional(),
    redacted: z.boolean().optional(),
    source: z.enum(["wp-config.php", ".env.example", ".env", "default"]),
})
    .strict();
const deployRequestSchema = z
    .object({
    appName: z
        .string()
        .min(3)
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "appName must be 3-60 chars, lowercase alphanumeric with single dashes as separators (e.g. 'my-wp-site')"),
    appType: z.enum(["wordpress", "woocommerce"]),
    stack: projectStackSchema,
    git: gitSourceSchema,
    envVars: z.array(envVarSchema).default([]),
    existingAppId: z.string().min(1).optional(),
    serverId: z.string().min(1).optional(),
})
    .strict();
export async function registerDeploymentRoutes(app, deps) {
    app.post("/deployments", async (request, reply) => {
        const parsed = deployRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            reply.code(400);
            return {
                error: "Invalid DeployRequest",
                issues: parsed.error.flatten(),
            };
        }
        const body = parsed.data;
        const resolvedServerId = body.serverId ?? deps.config.cloudways.serverId;
        if (!resolvedServerId) {
            reply.code(422);
            return {
                error: "No Cloudways serverId available. Pass `serverId` in the DeployRequest (recommended, from the plugin's picker/create flow) or set CLOUDWAYS_SERVER_ID in the backend .env as a fallback.",
            };
        }
        const deploymentId = randomUUID();
        const initial = deps.store.create({
            deploymentId,
            state: "pending",
            message: "Queued",
            cloudwaysServerId: resolvedServerId,
        });
        setImmediate(() => {
            void runDeployment(deploymentId, body, {
                cloudways: deps.cloudways,
                store: deps.store,
                config: deps.config,
                log: request.log,
            });
        });
        const resp = {
            deploymentId,
            statusUrl: `/deployments/${deploymentId}`,
        };
        reply.code(202);
        request.log.info({ deploymentId, initialState: initial.state }, "deploy.queued");
        return resp;
    });
    app.get("/deployments/:id", async (request, reply) => {
        const { id } = request.params;
        const found = deps.store.get(id);
        if (!found) {
            reply.code(404);
            return { error: `Unknown deployment ${id}` };
        }
        const out = found;
        return out;
    });
}
//# sourceMappingURL=deployments.js.map