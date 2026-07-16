import { z } from "zod";
import { apiClient, DeployApiError } from "../client.js";
/**
 * Cloudways label rules mirrored client-side so the LLM sees a validation
 * error before the tool call ever crosses the network. Matches the backend
 * regex in api/src/routes/servers.ts.
 */
const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LABEL_MSG = "must be 3-60 chars, lowercase alphanumeric with single dashes as separators (e.g. 'my-wp-site')";
const inputShape = {
    cloud: z
        .string()
        .min(1)
        .describe("Provider code (e.g. 'do', 'vultr', 'linode', 'aws', 'gce')."),
    region: z
        .string()
        .min(1)
        .describe("Region code returned by list_regions for the chosen cloud."),
    instanceType: z
        .string()
        .min(1)
        .describe("Server size code returned by list_instance_sizes."),
    application: z
        .enum(["wordpress", "woocommerce"])
        .describe("Initial application to install on the new server."),
    appVersion: z
        .string()
        .min(1)
        .optional()
        .describe("Optional Cloudways app version. Defaults to 'latest'."),
    serverLabel: z
        .string()
        .min(3)
        .max(60)
        .regex(LABEL_RE, `serverLabel ${LABEL_MSG}`)
        .describe("Human label for the server (visible in the Cloudways dashboard). Must be 3-60 chars, lowercase alphanumeric with single dashes. Used for idempotency: calling create_server again with the same label after a timed-out attempt will reuse the in-flight/created server instead of billing a duplicate."),
    appLabel: z
        .string()
        .min(3)
        .max(60)
        .regex(LABEL_RE, `appLabel ${LABEL_MSG}`)
        .describe("Label for the initial app Cloudways creates alongside the server. Must be 3-60 chars, lowercase alphanumeric with single dashes. Set this to the same slug you will pass to `deploy` as appName so no second app has to be created afterward. Cloudways rejects labels shorter than 3 characters with HTTP 422."),
    projectName: z
        .string()
        .min(3)
        .max(60)
        .regex(LABEL_RE, `projectName ${LABEL_MSG}`)
        .optional()
        .describe("Optional Cloudways project name. Defaults to appLabel."),
    timeoutSeconds: z
        .number()
        .int()
        .min(60)
        .max(60 * 30)
        .optional()
        .describe("Max seconds to wait for the server to reach a running state. Default 720s (12 minutes)."),
    pollIntervalSeconds: z
        .number()
        .int()
        .min(2)
        .max(60)
        .optional()
        .describe("Seconds between poll ticks while waiting. Default 10."),
};
export function registerCreateServer(server) {
    server.registerTool("create_server", {
        title: "Create a new Cloudways server",
        description: [
            "Launch a new Cloudways server with an initial application on it, then block",
            "until the server is running and returns its id. Idempotent by serverLabel:",
            "if a server with that label already exists (from a previous attempt), it is",
            "reused instead of spinning up a duplicate — safe to retry after a tool-call",
            "timeout. On success returns { serverId, plannedLabel, reused }.",
            "This tool spends real money and takes ~6 minutes for DigitalOcean; only call",
            "after the user has explicitly confirmed the choice.",
        ].join(" "),
        inputSchema: inputShape,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ cloud, region, instanceType, application, appVersion, serverLabel, appLabel, projectName, timeoutSeconds, pollIntervalSeconds, }) => {
        const timeoutMs = (timeoutSeconds ?? 720) * 1000;
        const intervalMs = (pollIntervalSeconds ?? 10) * 1000;
        try {
            const created = await apiClient.createServer({
                cloud,
                region,
                instanceType,
                application,
                appVersion,
                serverLabel,
                appLabel,
                projectName,
            });
            if (created.serverId) {
                return renderResult({
                    serverId: created.serverId,
                    plannedLabel: created.plannedLabel,
                    reused: created.reused ?? false,
                    status: created.reused ? "Reused existing server (idempotency)" : "Ready",
                });
            }
            if (!created.operationId) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: "Backend accepted the create request but returned no operationId or serverId; cannot poll.",
                        },
                    ],
                    structuredContent: { error: "no operation id" },
                };
            }
            const startedAt = Date.now();
            let last = "Waiting for Cloudways to start provisioning...";
            while (Date.now() - startedAt < timeoutMs) {
                const op = await apiClient.getServerOperation(created.operationId);
                last = op.status || last;
                if (op.isCompleted && op.serverId) {
                    return renderResult({
                        serverId: op.serverId,
                        plannedLabel: created.plannedLabel,
                        reused: false,
                        status: op.status || "Completed",
                        message: op.message,
                    });
                }
                if (op.isCompleted && !op.serverId) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Cloudways operation ${created.operationId} completed but no server id could be resolved for label "${created.plannedLabel}". Check the Cloudways dashboard.`,
                            },
                        ],
                        structuredContent: {
                            error: "server id not resolved",
                            operationId: created.operationId,
                            plannedLabel: created.plannedLabel,
                        },
                    };
                }
                await sleep(intervalMs);
            }
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: [
                            `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Cloudways to finish provisioning "${created.plannedLabel}".`,
                            `Last status: ${last}`,
                            `Call create_server again with the same serverLabel to reattach (idempotency),`,
                            `or check the dashboard: https://platform.cloudways.com/server`,
                        ].join("\n"),
                    },
                ],
                structuredContent: {
                    error: "timeout",
                    operationId: created.operationId,
                    plannedLabel: created.plannedLabel,
                    lastStatus: last,
                },
            };
        }
        catch (err) {
            return toError(err);
        }
    });
}
function renderResult(args) {
    const lines = [
        `Cloudways server ready.`,
        `Server ID: ${args.serverId}`,
        `Label: ${args.plannedLabel}`,
        `Status: ${args.status}`,
        args.reused ? "(reused an existing server — no charge added)" : null,
        args.message ? `Message: ${args.message}` : null,
        ``,
        `Next: call save_server_selection with this serverId to remember it for future deploys.`,
    ].filter(Boolean);
    return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
            serverId: args.serverId,
            plannedLabel: args.plannedLabel,
            reused: args.reused,
            status: args.status,
        },
    };
}
function toError(err) {
    if (err instanceof DeployApiError) {
        return {
            isError: true,
            content: [{ type: "text", text: err.message }],
            structuredContent: { error: err.message, status: err.status ?? null },
        };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
        isError: true,
        content: [{ type: "text", text: msg }],
        structuredContent: { error: msg },
    };
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=create_server.js.map