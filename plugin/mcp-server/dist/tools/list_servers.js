import { apiClient, DeployApiError } from "../client.js";
export function registerListServers(server) {
    server.registerTool("list_servers", {
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
    }, async () => {
        try {
            const { servers } = await apiClient.listServers();
            const text = servers.length === 0
                ? "No Cloudways servers found on this account."
                : servers
                    .map((s, i) => `${i + 1}. ${s.label}  \u00b7  ${s.cloud}  \u00b7  ${s.region}  \u00b7  ${s.size}  \u00b7  ${s.appsCount} app${s.appsCount === 1 ? "" : "s"}  \u00b7  ${s.status}  (id=${s.id})`)
                    .join("\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { servers },
            };
        }
        catch (err) {
            return errorToResult(err);
        }
    });
}
function errorToResult(err) {
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
//# sourceMappingURL=list_servers.js.map