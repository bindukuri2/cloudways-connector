import { z } from "zod";
import { apiClient, DeployApiError } from "../client.js";
const projectStackShape = z
    .object({
    framework: z.enum(["wordpress", "wordpress-bedrock", "static-landing", "unknown"]),
    hasWooCommerce: z.boolean(),
    phpVersion: z.string(),
    theme: z
        .object({ name: z.string(), slug: z.string() })
        .optional(),
    plugins: z
        .array(z.object({ slug: z.string(), name: z.string().optional() }))
        .default([]),
    evidence: z
        .array(z.object({ signal: z.string(), path: z.string() }))
        .default([]),
    workspaceRoot: z.string(),
})
    .strict();
const gitSourceShape = z
    .object({
    gitReady: z.boolean(),
    gitUrl: z.string().optional(),
    branch: z.string().optional(),
    dirty: z.boolean().optional(),
    reason: z.string().optional(),
})
    .strict();
const envVarShape = z
    .object({
    key: z.string(),
    value: z.string().optional(),
    redacted: z.boolean().optional(),
    source: z.enum(["wp-config.php", ".env.example", ".env", "default"]),
})
    .strict();
const inputShape = {
    appName: z
        .string()
        .min(3)
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "appName must be 3-60 chars, lowercase alphanumeric with single dashes as separators (e.g. 'my-wp-site'). Cloudways rejects shorter labels with HTTP 422.")
        .describe("Cloudways app label. Must be 3-60 chars, lowercase alphanumeric with single dashes (e.g. 'my-wp-site'). Normally derived by prepare_config from the workspace folder name."),
    appType: z
        .enum(["wordpress", "woocommerce"])
        .describe("Cloudways application type."),
    stack: projectStackShape,
    git: gitSourceShape,
    envVars: z.array(envVarShape).default([]),
    existingAppId: z.string().min(1).optional(),
    serverId: z
        .string()
        .min(1)
        .optional()
        .describe("Cloudways server id to deploy into. Normally forwarded from prepare_config (which reads .deploy-intel/config.json). Required unless the backend has a CLOUDWAYS_SERVER_ID fallback in its .env."),
};
export function registerDeploy(server) {
    server.registerTool("deploy", {
        title: "Deploy to Cloudways",
        description: [
            "POST a DeployRequest to the local deploy-intel-api backend at $DEPLOY_INTEL_API_URL (default http://localhost:8787).",
            "Returns `{ deploymentId, statusUrl }`. After calling this, poll with the `status` tool until the deployment is `live` or `failed`.",
            "If the backend is unreachable, the returned error message includes the URL we tried and instructions to start the backend.",
        ].join(" "),
        inputSchema: inputShape,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (req) => {
        try {
            const created = await apiClient.createDeployment(req);
            return {
                content: [
                    {
                        type: "text",
                        text: [
                            `Deployment accepted.`,
                            `Deployment ID: ${created.deploymentId}`,
                            `Status URL: ${created.statusUrl}`,
                            ``,
                            `Next: call the \`status\` tool with deploymentId="${created.deploymentId}" and stream progress to the user.`,
                        ].join("\n"),
                    },
                ],
                structuredContent: created,
            };
        }
        catch (err) {
            if (err instanceof DeployApiError) {
                return {
                    isError: true,
                    content: [{ type: "text", text: err.message }],
                    structuredContent: { error: err.message, status: err.status ?? null },
                };
            }
            throw err;
        }
    });
}
//# sourceMappingURL=deploy.js.map