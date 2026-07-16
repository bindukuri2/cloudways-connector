import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiClient, DeployApiError } from "../client.js";

const inputShape = {
  cloud: z
    .string()
    .min(1)
    .describe(
      "Provider code returned by list_providers (e.g. 'do', 'vultr', 'linode', 'aws', 'gce').",
    ),
};

export function registerListRegions(server: McpServer): void {
  server.registerTool(
    "list_regions",
    {
      title: "List Cloudways regions for a provider",
      description: [
        "Returns the regions available for the given cloud provider as",
        "[{ code, name, cloud }]. Call after list_providers so the user can pick",
        "geography before size.",
      ].join(" "),
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ cloud }) => {
      try {
        const { regions } = await apiClient.listRegions(cloud);
        const text =
          regions.length === 0
            ? `No regions returned for cloud=${cloud}.`
            : regions.map((r) => `- ${r.code}\t${r.name}`).join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { regions, cloud } as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toError(err);
      }
    },
  );
}

function toError(err: unknown) {
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
