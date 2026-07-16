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

export function registerListInstanceSizes(server: McpServer): void {
  server.registerTool(
    "list_instance_sizes",
    {
      title: "List Cloudways server sizes for a provider",
      description: [
        "Returns the launchable server sizes for the given cloud provider as",
        "[{ code, ram?, cpu?, disk?, priceMonthly?, cloud }]. Use to render a",
        "size picker with pricing so the user can confirm before create_server.",
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
        const { sizes } = await apiClient.listInstanceSizes(cloud);
        const text =
          sizes.length === 0
            ? `No sizes returned for cloud=${cloud}.`
            : sizes
                .map((s) => {
                  const bits = [`- ${s.code}`];
                  if (s.ram) bits.push(`${s.ram} RAM`);
                  if (s.cpu) bits.push(`${s.cpu} CPU`);
                  if (s.disk) bits.push(`${s.disk} disk`);
                  if (s.priceMonthly) bits.push(`~$${s.priceMonthly}/mo`);
                  return bits.join("  \u00b7  ");
                })
                .join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { sizes, cloud } as unknown as Record<string, unknown>,
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
