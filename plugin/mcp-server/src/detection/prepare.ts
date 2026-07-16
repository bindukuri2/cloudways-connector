/**
 * Turn a detected ProjectStack into a DeployRequest the backend can consume.
 *
 * Responsibilities:
 *   - Slug the workspace dir into an app name (or take an explicit override).
 *   - Pick app_type (wordpress vs woocommerce).
 *   - Extract WP_HOME/SITEURL/DEBUG/MEMORY_LIMIT constants from wp-config.php
 *     via regex (we never execute PHP).
 *   - For Bedrock projects, surface keys from .env.example (values redacted).
 *   - Resolve the Git remote URL + current branch via the local `git` CLI.
 */

import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AppType,
  DeployEnvVar,
  DeployRequest,
  GitSource,
  ProjectStack,
} from "../types.js";
import { readTextSafe } from "./fsutil.js";

const execFileAsync = promisify(execFile);

interface PrepareOptions {
  appNameOverride?: string;
}

export async function buildDeployRequest(
  stack: ProjectStack,
  opts: PrepareOptions = {},
): Promise<DeployRequest> {
  const appName = opts.appNameOverride
    ? slugify(opts.appNameOverride)
    : slugify(path.basename(stack.workspaceRoot));

  const appType: AppType = stack.hasWooCommerce ? "woocommerce" : "wordpress";

  const envVars = await extractEnvVars(stack);
  const git = await resolveGit(stack.workspaceRoot);

  return {
    appName,
    appType,
    stack,
    git,
    envVars,
  };
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "wp-app"
  );
}

const WP_CONFIG_KEYS = ["WP_HOME", "WP_SITEURL", "WP_DEBUG", "WP_DEBUG_LOG", "WP_MEMORY_LIMIT"];
const WP_SECRET_KEYS = new Set([
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_HOST",
  "AUTH_KEY",
  "SECURE_AUTH_KEY",
  "LOGGED_IN_KEY",
  "NONCE_KEY",
  "AUTH_SALT",
  "SECURE_AUTH_SALT",
  "LOGGED_IN_SALT",
  "NONCE_SALT",
]);

async function extractEnvVars(stack: ProjectStack): Promise<DeployEnvVar[]> {
  const out: DeployEnvVar[] = [];
  const root = stack.workspaceRoot;

  // 1. Classic WordPress: wp-config.php constants.
  const wpConfigCandidates = [
    path.join(root, "wp-config.php"),
    path.join(root, "wp-config-sample.php"),
    path.join(root, "web", "wp", "wp-config.php"),
    path.join(root, "wordpress", "wp-config.php"),
  ];
  for (const cand of wpConfigCandidates) {
    const txt = await readTextSafe(cand);
    if (!txt) continue;
    for (const key of WP_CONFIG_KEYS) {
      const value = parseDefine(txt, key);
      if (value !== null) {
        out.push({ key, value, source: "wp-config.php" });
      }
    }
    // Redact-only entries: surface that we saw them, omit value.
    for (const key of WP_SECRET_KEYS) {
      if (parseDefine(txt, key) !== null) {
        out.push({ key, redacted: true, source: "wp-config.php" });
      }
    }
    break;
  }

  // 2. Bedrock-style .env.example (keys only, values dropped).
  if (stack.framework === "wordpress-bedrock") {
    const envExampleTxt = await readTextSafe(path.join(root, ".env.example"));
    if (envExampleTxt) {
      for (const key of parseEnvKeys(envExampleTxt)) {
        out.push({ key, redacted: true, source: ".env.example" });
      }
    }
  }

  // De-dupe: keep first occurrence per (key, source).
  const seen = new Set<string>();
  return out.filter((v) => {
    const id = `${v.source}:${v.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function parseDefine(source: string, key: string): string | null {
  // Match `define('KEY', 'VALUE');` and `define( "KEY", true );` etc.
  const re = new RegExp(
    `define\\s*\\(\\s*['\"]${escapeRegex(key)}['\"]\\s*,\\s*(.+?)\\s*\\)\\s*;`,
    "i",
  );
  const m = source.match(re);
  if (!m || !m[1]) return null;
  return normalizePhpLiteral(m[1]);
}

function normalizePhpLiteral(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseEnvKeys(source: string): string[] {
  const keys: string[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (m && m[1]) keys.push(m[1]);
  }
  return keys;
}

async function resolveGit(workspaceRoot: string): Promise<GitSource> {
  const opts = { cwd: workspaceRoot, timeout: 5000 } as const;

  // Are we inside a git repo at all?
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], opts);
  } catch {
    return { gitReady: false, reason: "not a git repository" };
  }

  let gitUrl: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], opts);
    gitUrl = stdout.trim() || undefined;
  } catch {
    return { gitReady: false, reason: "no 'origin' remote configured" };
  }
  if (!gitUrl) return { gitReady: false, reason: "no 'origin' remote configured" };

  let branch: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts);
    branch = stdout.trim() || undefined;
  } catch {
    branch = undefined;
  }
  if (!branch || branch === "HEAD") {
    return { gitReady: false, gitUrl, reason: "detached HEAD; no branch to deploy" };
  }

  let dirty: boolean | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], opts);
    dirty = stdout.trim().length > 0;
  } catch {
    dirty = undefined;
  }

  return {
    gitReady: true,
    gitUrl: normalizeGitUrlForCloudways(gitUrl),
    branch,
    dirty,
  };
}

/**
 * Cloudways /git/clone expects SSH remotes, e.g. git@github.com:owner/repo.git
 */
export function normalizeGitUrlForCloudways(url: string): string {
  const trimmed = url.trim();
  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    return `git@${httpsMatch[1]}:${httpsMatch[2]}.git`;
  }
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/);
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return `git@${sshMatch[1]}:${sshMatch[2]}.git`;
  }
  return trimmed;
}
