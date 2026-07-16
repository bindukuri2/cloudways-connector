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
};
export function registerPrepareConfig(server) {
    server.registerTool("prepare_config", {
        title: "Prepare Cloudways deployment payload",
        description: [
            "Build a DeployRequest from the detected ProjectStack plus repo-level metadata (wp-config constants, .env keys, Git remote + branch).",
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
    }, async ({ workspaceRoot, appNameOverride }) => {
        const stack = await detectProjectStack(workspaceRoot);
        const request = await buildDeployRequest(stack, { appNameOverride });
        return {
            content: [
                {
                    type: "text",
                    text: [
                        `App: ${request.appName} (${request.appType})`,
                        `Server: pinned by backend (CLOUDWAYS_SERVER_ID)`,
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
//# sourceMappingURL=prepare_config.js.map