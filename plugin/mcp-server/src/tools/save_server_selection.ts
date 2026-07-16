import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const CONFIG_DIR = ".deploy-intel";
const CONFIG_FILE = "config.json";
const GITIGNORE_LINE = ".deploy-intel/";

const inputShape = {
  workspaceRoot: z
    .string()
    .min(1)
    .describe(
      "Absolute path to the user's workspace root. The config is written to <workspaceRoot>/.deploy-intel/config.json.",
    ),
  serverId: z
    .string()
    .min(1)
    .describe("Cloudways server id to remember for this workspace."),
  serverLabel: z
    .string()
    .min(1)
    .optional()
    .describe("Optional human-readable label to store alongside serverId for display."),
  appId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Cloudways app id to remember, so future deploys skip both the server picker and the label-based app lookup.",
    ),
};

export function registerSaveServerSelection(server: McpServer): void {
  server.registerTool(
    "save_server_selection",
    {
      title: "Persist the chosen Cloudways server for this workspace",
      description: [
        "Writes { cloudwaysServerId, cloudwaysServerLabel?, cloudwaysAppId? } to",
        "<workspaceRoot>/.deploy-intel/config.json (merging with any existing values)",
        "and ensures '.deploy-intel/' is present in .gitignore. Subsequent deploy",
        "runs will skip the server picker by reading this file inside prepare_config.",
      ].join(" "),
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspaceRoot, serverId, serverLabel, appId }) => {
      try {
        const dir = path.join(workspaceRoot, CONFIG_DIR);
        const file = path.join(dir, CONFIG_FILE);
        await fs.mkdir(dir, { recursive: true });

        const existing = await readJsonIfExists(file);
        const next: Record<string, unknown> = {
          ...existing,
          cloudwaysServerId: serverId,
        };
        if (serverLabel) next.cloudwaysServerLabel = serverLabel;
        if (appId) next.cloudwaysAppId = appId;

        await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
        const gitignoreEnsured = await ensureGitignoreEntry(workspaceRoot);

        return {
          content: [
            {
              type: "text",
              text: [
                `Saved Cloudways selection to ${path.relative(workspaceRoot, file)}.`,
                `  cloudwaysServerId = ${serverId}`,
                serverLabel ? `  cloudwaysServerLabel = ${serverLabel}` : null,
                appId ? `  cloudwaysAppId = ${appId}` : null,
                gitignoreEnsured
                  ? `Added '${GITIGNORE_LINE}' to .gitignore.`
                  : `.gitignore already ignores '${GITIGNORE_LINE}'.`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          structuredContent: {
            path: file,
            saved: next,
            gitignoreUpdated: gitignoreEnsured,
          } as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to save selection: ${msg}` }],
          structuredContent: { error: msg } as Record<string, unknown>,
        };
      }
    },
  );
}

async function readJsonIfExists(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function ensureGitignoreEntry(workspaceRoot: string): Promise<boolean> {
  const gi = path.join(workspaceRoot, ".gitignore");
  let existing = "";
  try {
    existing = await fs.readFile(gi, "utf8");
  } catch {
    existing = "";
  }
  const hasEntry = existing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === GITIGNORE_LINE || l === ".deploy-intel");
  if (hasEntry) return false;
  const suffix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await fs.writeFile(gi, `${existing}${suffix}${GITIGNORE_LINE}\n`, "utf8");
  return true;
}
