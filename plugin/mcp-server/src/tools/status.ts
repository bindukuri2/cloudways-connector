import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiClient, DeployApiError } from "../client.js";

const inputShape = {
  deploymentId: z
    .string()
    .min(1)
    .describe("Deployment ID returned from the `deploy` tool."),
  waitMs: z
    .number()
    .int()
    .min(0)
    .max(30_000)
    .optional()
    .describe(
      "Optional client-side wait before polling, in milliseconds. Use ~5000 between repeated calls to avoid hammering the backend.",
    ),
};

export function registerStatus(server: McpServer): void {
  server.registerTool(
    "status",
    {
      title: "Poll deployment status",
      description: [
        "Fetch the current DeployStatus from the backend.",
        "Returns the state (`pending` | `authenticating` | `creating_app` | `attaching_git` | `pulling_git` | `purging_cache` | `live` | `failed`), a human-readable progress message, and (when live) the final `url`.",
        "Call this repeatedly with the same deploymentId until state is `live` or `failed`. The skill should pace itself (~5s between calls).",
      ].join(" "),
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ deploymentId, waitMs }) => {
      if (typeof waitMs === "number" && waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
      try {
        const status = await apiClient.getDeployment(deploymentId);
        return {
          content: [{ type: "text", text: renderStatus(status) }],
          structuredContent: status as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof DeployApiError) {
          return {
            isError: true,
            content: [{ type: "text", text: err.message }],
            structuredContent: { error: err.message, status: err.status ?? null } as Record<
              string,
              unknown
            >,
          };
        }
        throw err;
      }
    },
  );
}

function renderStatus(s: Awaited<ReturnType<typeof apiClient.getDeployment>>): string {
  const lines = [
    `State: ${s.state}`,
    `Message: ${s.message}`,
  ];
  if (s.cloudwaysAppId) lines.push(`Cloudways app ID: ${s.cloudwaysAppId}`);
  if (s.cloudwaysServerId) lines.push(`Cloudways server ID: ${s.cloudwaysServerId}`);
  if (s.cloudwaysOperations && s.cloudwaysOperations.length > 0) {
    lines.push("Cloudways operations (cross-reference in dashboard):");
    for (const op of s.cloudwaysOperations) {
      const status = op.status ? ` — ${op.status}` : "";
      lines.push(`  - ${op.kind} op #${op.operationId}${status}`);
    }
  }
  if (s.cache) {
    lines.push(
      `Cache: app=${s.cache.appCachePurged ? "purged" : "not purged"}, varnish=${
        s.cache.varnishPurged ? "purged" : "not purged"
      }`,
    );
    if (s.cache.appCacheError) lines.push(`App cache warning: ${s.cache.appCacheError}`);
    if (s.cache.varnishError) lines.push(`Varnish warning: ${s.cache.varnishError}`);
  }
  if (s.url) lines.push(`URL: ${s.url}`);
  if (s.error) lines.push(`Error: ${s.error}`);
  return lines.join("\n");
}
