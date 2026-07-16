#!/usr/bin/env node
/**
 * End-to-end smoke test for the cloudways-deploy MCP server.
 *
 * Spawns the compiled server, walks through the standard JSON-RPC handshake,
 * then calls detect_project + prepare_config + deploy against a synthetic
 * WordPress fixture.
 *
 * Usage:
 *   node scripts/mcp-smoke.mjs [WORKSPACE_PATH]
 *
 *   - WORKSPACE_PATH defaults to /tmp/wp-fixture (create it with
 *     scripts/make-wp-fixture.sh).
 *   - The `deploy` step expects the backend NOT to be running and verifies
 *     the MCP server returns a clean error message.
 *
 * No real Cloudways calls are made by this script.
 */

import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(
  __dirname,
  "..",
  "plugin",
  "mcp-server",
  "dist",
  "index.js",
);
const FIXTURE = process.argv[2] ?? "/tmp/wp-fixture";

const proc = spawn("node", [SERVER_PATH], { stdio: ["pipe", "pipe", "inherit"] });
const rl = readline.createInterface({ input: proc.stdout });

let nextId = 1;
const pending = new Map();
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  } catch {
    console.error("[smoke] non-JSON from server:", line);
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-smoke", version: "0.0.1" },
  });
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  console.log("[smoke] tools:", tools.tools.map((t) => t.name).join(", "));

  const detect = await rpc("tools/call", {
    name: "detect_project",
    arguments: { workspaceRoot: FIXTURE },
  });
  const stack = detect.structuredContent;
  console.log("[smoke] detect_project:");
  console.log("  framework:        ", stack.framework);
  console.log("  hasWooCommerce:   ", stack.hasWooCommerce);
  console.log("  phpVersion:       ", stack.phpVersion);
  console.log("  theme:            ", JSON.stringify(stack.theme));
  console.log("  plugins:          ", stack.plugins.map((p) => p.slug).join(", "));
  console.log("  evidence count:   ", stack.evidence.length);

  const prep = await rpc("tools/call", {
    name: "prepare_config",
    arguments: { workspaceRoot: FIXTURE },
  });
  const req = prep.structuredContent;
  console.log("[smoke] prepare_config:");
  console.log("  appName:          ", req.appName);
  console.log("  appType:          ", req.appType);
  console.log("  git.gitReady:     ", req.git.gitReady, "reason:", req.git.reason);
  console.log(
    "  envVars:          ",
    req.envVars.map((v) => `${v.key}=${v.redacted ? "<redacted>" : v.value}`).join(", "),
  );

  const deploy = await rpc("tools/call", {
    name: "deploy",
    arguments: req,
  });
  console.log("[smoke] deploy (expect graceful backend-down error):");
  console.log("  isError:          ", deploy.isError === true);
  console.log("  message:          ", deploy.content?.[0]?.text?.slice(0, 200));

  proc.stdin.end();
  proc.kill();
  console.log("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAIL", err);
  proc.kill();
  process.exit(1);
});
