import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiClient, DeployApiError } from "../client.js";

export function registerListServers(server: McpServer): void {
  server.registerTool(
    "list_servers",
    {
      title: "List Cloudways servers",
      description: [
        "Returns every Cloudways server on the connected account, normalized to",
        "{ id, label, cloud, region, size, status, publicIp, appsCount, apps[] }.",
        "The skill uses this as step one of the deploy flow to decide between",
        "auto-picking, showing a picker, or entering the create-server flow.",
      ].join(" "),
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const { servers } = await apiClient.listServers();
        const text =
          servers.length === 0
            ? "No Cloudways servers found on this account."
            : servers
                .map(
                  (s, i) =>
                    `${i + 1}. ${s.label}  \u00b7  ${s.cloud}  \u00b7  ${s.region}  \u00b7  ${s.size}  \u00b7  ${s.appsCount} app${s.appsCount === 1 ? "" : "s"}  \u00b7  ${s.status}  (id=${s.id})`,
                )
                .join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { servers } as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return errorToResult(err);
      }
    },
  );
}

function errorToResult(err: unknown) {
  if (err instanceof DeployApiError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: err.message }],
      structuredContent: { error: err.message, status: err.status ?? null } as Record<
        string,
        unknown
      >,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: msg }],
    structuredContent: { error: msg } as Record<string, unknown>,
  };
}
