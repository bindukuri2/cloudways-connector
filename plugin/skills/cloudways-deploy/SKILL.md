---
name: cloudways-deploy
description: Deploy the current workspace, when it is a WordPress or WooCommerce project, to Cloudways managed cloud hosting, returning a live URL in one chat turn. Use this skill whenever the user expresses deployment intent for a WP / WooCommerce site, including phrasings like "deploy this WordPress site", "deploy this WP app", "ship this WooCommerce store", "publish this site", "publish my WordPress site live", "make this live", "make this live on Cloudways", "put this on Cloudways", "host this WP app", "launch my WP site", "deploy to Cloudways", "deploy this to cloudways", "ship this site to the cloud", "I want to go live", "let's get this online", "release this site". Also use this skill when the user asks how to deploy a WordPress / WooCommerce project they have open — explain that this skill can do it for them with one confirmation. Do NOT trigger this skill for non-WordPress / non-WooCommerce projects (Next.js, Vite, Django, Rails, plain HTML, mobile apps, generic Node services), for local-only setup tasks ("install WP locally", "run WP in Docker"), for discussions about Cloudways pricing or plans, for debugging an already-deployed site, or when the user only asks general questions about hosting without asking to deploy.
---

# Cloudways Deploy

You are the user's deployment driver for a WordPress / WooCommerce project. Your job is to take the current workspace from "I want to deploy" to a live Cloudways URL in as few turns as possible, with no guesswork.

## Required tools

This skill is powered by the `cloudways-deploy` MCP server. You MUST use its tools — do not try to call the Cloudways API directly or run `curl`/`wp` CLIs to deploy.

The five tools, in the order you will normally call them:

1. `detect_project` — scans the workspace for WordPress / WooCommerce / Bedrock / static-landing signals. Returns a `ProjectStack` with framework, WC flag, PHP version, theme, plugins, and `evidence` (which files matched).
2. `scaffold_wp_theme` — used only when `detect_project` returns `framework: "static-landing"`. Wraps the user's `index.html` in a real WordPress theme and drops an mu-plugin that auto-activates it, so the deploy doesn't land on Cloudways' default Twenty Twenty-Five.
3. `prepare_config` — turns the detected stack + repo metadata (Git remote, branch, wp-config constants) into a `DeployRequest` payload ready for the backend.
4. `deploy` — POSTs the `DeployRequest` to the local backend (`http://localhost:8787/deployments`). Returns a `deploymentId`.
5. `status` — polls `GET /deployments/:id` until the deployment is `live` or `failed`. Stream progress lines to the user as you go.

## Workflow

Follow these steps strictly. Do not skip ahead.

### Step 1 — Confirm intent and detect

- Call `detect_project` with the absolute path of the user's workspace root.
- If `framework === "unknown"`, stop and tell the user this does not look like a WordPress project. Show the top 3 entries of `evidence` so they can confirm.
- If `framework === "static-landing"`, jump to **Step 1b — Scaffold a WordPress theme** before continuing.
- Otherwise summarize one line:
  > "Detected `{framework}`{`, WooCommerce` if hasWooCommerce}, PHP {phpVersion}, theme `{theme.slug}`, {plugins.length} plugins."

### Step 1b — Scaffold a WordPress theme (only for `static-landing`)

The user has a static landing page (e.g. `index.html`) and wants it on Cloudways' managed WordPress. Wrap it in a theme BEFORE deploying — otherwise Cloudways serves its default WP install and the user sees the generic "Welcome to WordPress" page (this is the exact bug we are encoding away). Anti-patterns to refuse:

- writing a `deploy.sh` / `rsync` / `scp` workflow
- telling the user to manually create a theme in the Cloudways dashboard
- pushing `index.html` directly to `public_html/` (Apache prefers `index.html` over `index.php`)

The right path:

1. Pick a theme slug (lowercase kebab-case; default = slug of the workspace directory name).
2. Pick a theme display name (default = workspace dir name in Title Case).
3. Read the `<title>` from `index.html` for the site title; if missing, ask the user.
4. Call `scaffold_wp_theme` with `workspaceRoot`, `themeSlug`, `themeName`, and optional `siteTitle`. By default it removes `index.html` after extracting its content (required — Apache prefers `index.html` over `index.php`).
5. The tool returns a list of created / removed files plus any warnings. Show that to the user.
6. Commit and push the scaffolded files using the shell tool, from the workspace root:
   - `git add .`
   - `git commit -m "Scaffold WordPress theme + activator for Cloudways deploy"`
   - `git push`
7. Re-run `detect_project`; it should now report `framework: "wordpress"` because the new `wp-content/themes/<slug>/style.css` + `wp-content/mu-plugins/<slug>-activator.php` are present.

Only proceed to Step 2 after the push succeeds.

### Step 2 — Prepare the deployment

- Call `prepare_config` with the same workspace path. It will:
  - Extract WP env-style constants from `wp-config.php` (`WP_HOME`, `WP_SITEURL`, `WP_DEBUG`, `WP_DEBUG_LOG`, `WP_MEMORY_LIMIT`).
  - Derive `app_name` (slug of the workspace dir).
  - Pick `app_type` (`wordpress` or `woocommerce`).
  - Detect Git remote URL + current branch via `git`.
- Print a 4-line plan to the user:
  > 1. App: `{app_name}` ({app_type})
  > 2. Server: pinned by backend (`CLOUDWAYS_SERVER_ID`)
  > 3. Git: `{git_url}` @ `{branch}` (or "skipped — no remote" if `gitReady=false`)
  > 4. Env: {N} vars surfaced

- If `gitReady === false`, ask the user whether to proceed without code (fresh WP install) or to set up a remote first. Do not invent a Git URL.

### Step 3 — Deploy

- Call `deploy` with the `DeployRequest` returned from `prepare_config`.
- If it returns an error (backend unreachable, missing env vars), surface the message verbatim and stop. The most common failure is the local API not running on `localhost:8787` — tell the user to run `npm run dev` in `api/`.
- On success, you get back `{ deploymentId, statusUrl }`.

### Step 4 — Watch it go live

- Call `status` with the `deploymentId`. It long-polls server-side and returns progress events.
- Each time you get a new state, print one line, e.g.:
  - `Creating WordPress app on server $CLOUDWAYS_SERVER_ID...`
  - `Cloning Git from {git_url}@{branch}...`
  - `Live at https://...`
- Stop polling when state is `live` or `failed`.

### Step 5 — Final message

On success, output exactly one block to the user:

```
Deployed! ✅

URL: <final_url>
App ID: <cloudways_app_id>
Server ID: <cloudways_server_id>
```

On failure, output the `error` field verbatim and suggest the most likely next step (re-run, check API key, check Git remote).

## Rules

- Never deploy without a successful `detect_project` (no manual override).
- Never modify the user's workspace files.
- Never paste Cloudways API keys into the chat or logs — they live in the backend `.env`.
- If any tool returns an error, surface it and stop. Do not retry blindly.
- This skill is POC-scoped: one hardcoded `CLOUDWAYS_SERVER_ID` on the backend. Do not ask the user about server cloud/region/size — those are out of scope.

## Triggering examples

Should trigger:

- "deploy this WordPress site"
- "ship this WooCommerce store to Cloudways"
- "publish this site live"
- "make this live"
- "put this on Cloudways"
- "I want to go live with this WP site"
- "let's get this WooCommerce store online"

Should NOT trigger:

- "how much does Cloudways cost?"  -> general pricing question, not a deploy ask
- "fix the 500 error on my live site"  -> debugging, not a fresh deploy
- "install WordPress on my laptop"  -> local setup
- "deploy this Next.js app"  -> wrong stack
- "what is Cloudways?"  -> informational
