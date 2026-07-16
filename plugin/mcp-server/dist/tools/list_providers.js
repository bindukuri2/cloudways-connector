import { apiClient, DeployApiError } from "../client.js";
export function registerListProviders(server) {
    server.registerTool("list_providers", {
        title: "List Cloudways cloud providers",
        description: [
            "Returns the set of cloud providers Cloudways can launch servers on",
            "(DigitalOcean, Vultr, Linode, AWS, GCE, ...) as [{ code, name }].",
            "Used by the create-server flow when the user's account has zero servers",
            "and the LLM is walking them through the choices.",
        ].join(" "),
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async () => {
        try {
            const { providers } = await apiClient.listProviders();
            const text = providers.length === 0
                ? "No providers returned by Cloudways."
                : providers.map((p) => `- ${p.code}\t${p.name}`).join("\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { providers },
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
//# sourceMappingURL=list_providers.js.map