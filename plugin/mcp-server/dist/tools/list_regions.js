import { z } from "zod";
import { apiClient, DeployApiError } from "../client.js";
const inputShape = {
    cloud: z
        .string()
        .min(1)
        .describe("Provider code returned by list_providers (e.g. 'do', 'vultr', 'linode', 'aws', 'gce')."),
};
export function registerListRegions(server) {
    server.registerTool("list_regions", {
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
    }, async ({ cloud }) => {
        try {
            const { regions } = await apiClient.listRegions(cloud);
            const text = regions.length === 0
                ? `No regions returned for cloud=${cloud}.`
                : regions.map((r) => `- ${r.code}\t${r.name}`).join("\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { regions, cloud },
            };
        }
        catch (err) {
            return toError(err);
        }
    });
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
//# sourceMappingURL=list_regions.js.map