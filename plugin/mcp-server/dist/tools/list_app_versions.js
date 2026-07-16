import { z } from "zod";
import { apiClient, DeployApiError } from "../client.js";
const inputShape = {
    application: z
        .enum(["wordpress", "woocommerce"])
        .describe("Cloudways application family whose versions we want to enumerate."),
};
export function registerListAppVersions(server) {
    server.registerTool("list_app_versions", {
        title: "List Cloudways app versions",
        description: [
            "Returns [{ application, version, isDefault? }] for the given application",
            "family (wordpress or woocommerce). Optional call before create_server —",
            "the default 'latest' works for POC.",
        ].join(" "),
        inputSchema: inputShape,
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ application }) => {
        try {
            const { versions } = await apiClient.listAppVersions(application);
            const text = versions.length === 0
                ? `No versions returned for application=${application}.`
                : versions
                    .map((v) => `- ${v.version}${v.isDefault ? "  (default)" : ""}`)
                    .join("\n");
            return {
                content: [{ type: "text", text }],
                structuredContent: { versions, application },
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
//# sourceMappingURL=list_app_versions.js.map