import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { detectProjectStack } from "../detection/index.js";

const inputShape = {
  workspaceRoot: z
    .string()
    .min(1)
    .describe(
      "Absolute path to the user's workspace root. The detector reads files in read-only mode and never executes anything from disk.",
    ),
};

export function registerDetectProject(server: McpServer): void {
  server.registerTool(
    "detect_project",
    {
      title: "Detect WordPress / WooCommerce stack",
      description: [
        "Scan the workspace at `workspaceRoot` for WordPress, Bedrock, and WooCommerce signals.",
        "Returns a ProjectStack with framework, hasWooCommerce, phpVersion, theme, plugins, and evidence (which files matched).",
        "Use this as the first step of any Cloudways deployment workflow so we can confirm we know how to build the project.",
      ].join(" "),
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspaceRoot }) => {
      const stack = await detectProjectStack(workspaceRoot);
      return {
        content: [
          {
            type: "text",
            text: summarize(stack),
          },
        ],
        structuredContent: stack as unknown as Record<string, unknown>,
      };
    },
  );
}

function summarize(stack: Awaited<ReturnType<typeof detectProjectStack>>): string {
  if (stack.framework === "unknown") {
    const top = stack.evidence.slice(0, 3).map((e) => `- ${e.signal} (${e.path})`).join("\n");
    return [
      "No WordPress markers found at the given workspace root.",
      "Top inspected paths:",
      top || "(no candidate evidence collected)",
    ].join("\n");
  }
  if (stack.framework === "static-landing") {
    const top = stack.evidence.slice(0, 5).map((e) => `- ${e.signal} (${e.path})`).join("\n");
    return [
      "Framework: static-landing (index.html with no WordPress files yet).",
      "",
      "To deploy this on Cloudways' managed WordPress you MUST first wrap",
      "the landing page in a WordPress theme. Call the `scaffold_wp_theme`",
      "MCP tool with a slug + display name. It will:",
      "  1. Create wp-content/themes/<slug>/ (style.css, header/footer/front-page/index/functions PHP).",
      "  2. Create wp-content/mu-plugins/<slug>-activator.php so the theme",
      "     auto-activates on the first request.",
      "  3. Delete the original index.html (Apache prefers index.html over",
      "     index.php and would otherwise keep serving the static page).",
      "",
      "After scaffolding, the user must `git add . && git commit && git push`",
      "before running the deploy, because Cloudways pulls from Git.",
      "",
      "Evidence:",
      top,
    ].join("\n");
  }
  return [
    `Framework: ${stack.framework}`,
    `WooCommerce: ${stack.hasWooCommerce ? "yes" : "no"}`,
    `PHP: ${stack.phpVersion}`,
    stack.theme ? `Theme: ${stack.theme.name} (${stack.theme.slug})` : "Theme: (none detected)",
    `Plugins detected: ${stack.plugins.length}`,
    `Evidence count: ${stack.evidence.length}`,
  ].join("\n");
}
