import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { detectProjectStack } from "../detection/index.js";
import { buildDeployRequest } from "../detection/prepare.js";
const inputShape = {
    workspaceRoot: z
        .string()
        .min(1)
        .describe("Absolute path to the user's workspace root."),
    appNameOverride: z
        .string()
        .min(1)
        .optional()
        .describe("Optional explicit Cloudways app label. Defaults to the slugified basename of the workspace."),
    serverId: z
        .string()
        .min(1)
        .optional()
        .describe("Optional Cloudways server id chosen by the skill's picker/create flow. Overrides any value cached in .deploy-intel/config.json."),
    existingAppIdOverride: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing Cloudways app id to reuse instead of creating a new one. Overrides any value cached in .deploy-intel/config.json."),
};
export function registerPrepareConfig(server) {
    server.registerTool("prepare_config", {
        title: "Prepare Cloudways deployment payload",
        description: [
            "Build a DeployRequest from the detected ProjectStack plus repo-level metadata (wp-config constants, .env keys, Git remote + branch).",
            "Also pulls a cached server/app selection from <workspaceRoot>/.deploy-intel/config.json when present (written by save_server_selection).",
            "Returns the exact payload that should be POSTed to the deploy-intel-api backend via the `deploy` tool.",
            "If the Git working tree has no remote, the returned `git.gitReady` is false and `git.reason` explains why; the skill must surface this to the user before calling `deploy`.",
        ].join(" "),
        inputSchema: inputShape,
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ workspaceRoot, appNameOverride, serverId, existingAppIdOverride }) => {
        const stack = await detectProjectStack(workspaceRoot);
        const request = await buildDeployRequest(stack, { appNameOverride });
        const cached = await readWorkspaceConfig(workspaceRoot);
        const resolvedServerId = serverId ?? cached.cloudwaysServerId;
        const resolvedAppId = existingAppIdOverride ?? cached.cloudwaysAppId;
        if (resolvedServerId)
            request.serverId = resolvedServerId;
        if (resolvedAppId)
            request.existingAppId = resolvedAppId;
        const serverLine = resolvedServerId
            ? `Server: ${cached.cloudwaysServerLabel ? `${cached.cloudwaysServerLabel} (id=${resolvedServerId})` : resolvedServerId}${serverId ? " [override]" : cached.cloudwaysServerId ? " [from .deploy-intel/config.json]" : ""}`
            : `Server: not selected yet — run the picker (list_servers) or create_server before calling deploy`;
        return {
            content: [
                {
                    type: "text",
                    text: [
                        `App: ${request.appName} (${request.appType})`,
                        serverLine,
                        request.git.gitReady
                            ? `Git: ${request.git.gitUrl} @ ${request.git.branch}`
                            : `Git: skipped (${request.git.reason ?? "no remote"})`,
                        `Env vars surfaced: ${request.envVars.length}`,
                    ].join("\n"),
                },
            ],
            structuredContent: request,
        };
    });
}
async function readWorkspaceConfig(workspaceRoot) {
    const file = path.join(workspaceRoot, ".deploy-intel", "config.json");
    try {
        const raw = await fs.readFile(file, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return {};
        const obj = parsed;
        const out = {};
        if (typeof obj.cloudwaysServerId === "string")
            out.cloudwaysServerId = obj.cloudwaysServerId;
        if (typeof obj.cloudwaysServerLabel === "string")
            out.cloudwaysServerLabel = obj.cloudwaysServerLabel;
        if (typeof obj.cloudwaysAppId === "string")
            out.cloudwaysAppId = obj.cloudwaysAppId;
        return out;
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=prepare_config.js.map