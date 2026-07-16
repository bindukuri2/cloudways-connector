#!/usr/bin/env node
/**
 * Entry point for the cloudways-deploy MCP server.
 *
 * Spawned by Cursor as a stdio child process (see ../mcp.json).
 * Stdout is reserved for the MCP transport — only log to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerDetectProject } from "./tools/detect_project.js";
import { registerPrepareConfig } from "./tools/prepare_config.js";
import { registerDeploy } from "./tools/deploy.js";
import { registerStatus } from "./tools/status.js";
import { registerScaffoldWpTheme } from "./tools/scaffold_wp_theme.js";
import { getApiBaseUrl } from "./client.js";
async function main() {
    const server = new McpServer({
        name: "cloudways-deploy",
        version: "0.1.0",
    });
    registerDetectProject(server);
    registerPrepareConfig(server);
    registerScaffoldWpTheme(server);
    registerDeploy(server);
    registerStatus(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[cloudways-deploy] MCP server up. Backend: ${getApiBaseUrl()}`);
}
main().catch((err) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[cloudways-deploy] fatal:`, msg);
    process.exit(1);
});
//# sourceMappingURL=index.js.map