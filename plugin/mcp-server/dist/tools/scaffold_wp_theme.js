import { z } from "zod";
import { scaffoldWpTheme } from "../scaffolding/wp_theme.js";
const inputShape = {
    workspaceRoot: z
        .string()
        .min(1)
        .describe("Absolute path to the user's workspace root. Must contain an index.html at the top level."),
    themeSlug: z
        .string()
        .min(2)
        .max(40)
        .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/i, "themeSlug must be lowercase kebab-case")
        .describe("Lowercase kebab-case slug for the WordPress theme directory (e.g. 'havemyburger')."),
    themeName: z
        .string()
        .min(1)
        .max(120)
        .describe("Human-readable theme name written into style.css Theme Name header. Defaults to the slug if not provided."),
    siteTitle: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Site title the activator mu-plugin will set via update_option('blogname', ...). Defaults to the <title> from index.html, then to themeName."),
    removeIndexHtml: z
        .boolean()
        .optional()
        .describe("If true (default), deletes the original index.html after extracting its content. Apache's DirectoryIndex prefers index.html over index.php, so leaving it makes the static page win over WordPress."),
};
export function registerScaffoldWpTheme(server) {
    server.registerTool("scaffold_wp_theme", {
        title: "Scaffold a WordPress theme from a static landing page",
        description: [
            "Convert a static landing page (index.html at the workspace root) into a",
            "real WordPress theme plus an mu-plugin that auto-activates it.",
            "Use this when `detect_project` returns framework=\"static-landing\".",
            "Creates wp-content/themes/<slug>/ (style.css, header.php, footer.php,",
            "front-page.php, index.php, functions.php) and",
            "wp-content/mu-plugins/<slug>-activator.php.",
            "By default deletes the original index.html so Apache doesn't serve it",
            "before WordPress's index.php.",
        ].join(" "),
        inputSchema: inputShape,
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
    }, async ({ workspaceRoot, themeSlug, themeName, siteTitle, removeIndexHtml }) => {
        try {
            const result = await scaffoldWpTheme({
                workspaceRoot,
                themeSlug,
                themeName,
                siteTitle,
                removeIndexHtml,
            });
            const summary = [
                `Theme: ${themeName} (slug=${themeSlug})`,
                `Theme dir: ${result.themeDir}`,
                `mu-plugin: ${result.muPluginPath}`,
                result.detectedTitle ? `Detected/used site title: ${result.detectedTitle}` : null,
                `Created files (${result.created.length}):`,
                ...result.created.map((p) => `  - ${p}`),
                result.removed.length > 0
                    ? `Removed files (${result.removed.length}):\n${result.removed.map((p) => `  - ${p}`).join("\n")}`
                    : null,
                result.warnings.length > 0
                    ? `Warnings:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n");
            return {
                content: [{ type: "text", text: summary }],
                structuredContent: result,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                isError: true,
                content: [{ type: "text", text: message }],
                structuredContent: { error: message },
            };
        }
    });
}
//# sourceMappingURL=scaffold_wp_theme.js.map