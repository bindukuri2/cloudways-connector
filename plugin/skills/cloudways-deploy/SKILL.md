---
name: cloudways-deploy
description: Deploy the current workspace, when it is a WordPress or WooCommerce project, to Cloudways managed cloud hosting, returning a live URL in one chat turn. Use this skill whenever the user expresses deployment intent for a WP / WooCommerce site, including phrasings like "deploy this WordPress site", "deploy this WP app", "ship this WooCommerce store", "publish this site", "publish my WordPress site live", "make this live", "make this live on Cloudways", "put this on Cloudways", "host this WP app", "launch my WP site", "deploy to Cloudways", "deploy this to cloudways", "ship this site to the cloud", "I want to go live", "let's get this online", "release this site". Also use this skill when the user asks how to deploy a WordPress / WooCommerce project they have open — explain that this skill can do it for them with one confirmation. Do NOT trigger this skill for non-WordPress / non-WooCommerce projects (Next.js, Vite, Django, Rails, plain HTML, mobile apps, generic Node services), for local-only setup tasks ("install WP locally", "run WP in Docker"), for discussions about Cloudways pricing or plans, for debugging an already-deployed site, or when the user only asks general questions about hosting without asking to deploy.
---

# Cloudways Deploy

You are the user's deployment driver for a WordPress / WooCommerce project. Your job is to take the current workspace from "I want to deploy" to a live Cloudways URL in as few turns as possible, with no guesswork.

## Required tools

This skill is powered by the `cloudways-deploy` MCP server. You MUST use its tools — do not try to call the Cloudways API directly or run `curl`/`wp` CLIs to deploy.

The tools, grouped by the phase you will call them in:

**Project detection**
1. `detect_project` — scans the workspace for WordPress / WooCommerce / Bedrock / static-landing signals. Returns a `ProjectStack` with framework, WC flag, PHP version, theme, plugins, and `evidence` (which files matched).
2. `scaffold_wp_theme` — used only when `detect_project` returns `framework: "static-landing"`. Wraps the user's `index.html` in a real WordPress theme and drops an mu-plugin that auto-activates it, so the deploy doesn't land on Cloudways' default Twenty Twenty-Five.

**Server selection (new — replaces the old CLOUDWAYS_SERVER_ID env pinning)**
3. `list_servers` — lists all Cloudways servers on the connected account. First call of every deploy after `detect_project`.
4. `list_providers` — lists cloud providers (DO, Vultr, Linode, AWS, GCE). Only used in the zero-server create flow.
5. `list_regions` — lists regions for a chosen cloud. Only used in the create flow.
6. `list_instance_sizes` — lists server sizes for a chosen cloud, with pricing. Only used in the create flow.
7. `list_app_versions` — optional; enumerates Cloudways WP / WC versions. Default `"latest"` is fine for POC.
8. `create_server` — launches a new Cloudways server (blocking, ~6 min). Idempotent by `serverLabel` so a retry after a timeout reuses the in-flight server instead of billing a duplicate. **Only call after the user explicitly confirms cloud + region + size + label.**
9. `save_server_selection` — writes the chosen `serverId` (and optional `appId`) to `<workspaceRoot>/.deploy-intel/config.json` and adds the folder to `.gitignore`. Call after any picker/create path so future deploys skip the picker.

**Deploy**
10. `prepare_config` — turns the detected stack + repo metadata (Git remote, branch, wp-config constants) into a `DeployRequest`. Reads `.deploy-intel/config.json` and injects `serverId` / `existingAppId` automatically.
11. `deploy` — POSTs the `DeployRequest` to the local backend (`http://localhost:8787/deployments`). Returns a `deploymentId`.
12. `status` — polls `GET /deployments/:id` until the deployment is `live` or `failed`. Stream progress lines to the user as you go.

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

Only proceed to Step 1.5 after the push succeeds.

### Step 1.5 — Choose or create a Cloudways server

This step is mandatory and replaces the old `CLOUDWAYS_SERVER_ID` env pinning. The DeployRequest now carries a `serverId` and the backend fails if one isn't provided.

**First check for a cached selection.** Read `<workspaceRoot>/.deploy-intel/config.json`. If it already contains `cloudwaysServerId`, echo one line to the user and skip straight to Step 2:

> Deploying to `{cloudwaysServerLabel}` (id=`{cloudwaysServerId}`). Say "switch server" to pick another.

**Otherwise call `list_servers` and branch on the count:**

**Before either branch runs, derive the app label the same way `prepare_config` will:** slugify the workspace directory name, and auto-pad it with `-app` if the slug is under 3 characters. Call this `derivedAppLabel`. You will need it in the confirmation prompt below.

#### N servers (numbered picker)

Show a numbered list, sorted alphabetically by label. Filter out servers with `status` other than `"running"` and list them under a "Not shown" footnote instead. If any server in the list already has an app whose `label` equals `derivedAppLabel`, put that server first with a `[recommended — already has app "{derivedAppLabel}"]` tag.

```
You have {N} Cloudways servers. Which one should I deploy to?

  1. my-prod       · do   · nyc3       · 1gb · 3 apps · running   [recommended — already has app "my-wp-site"]
  2. wc-staging    · do   · sfo3       · 2gb · 1 app  · running
  3. legacy-aws    · aws  · us-east-1  · 4gb · 6 apps · running

Reply with the number, or 'new' to create another server, or 'cancel' to stop.

Not shown:
  - test-do (stopped)
```

If the user picks `new`, drop into the 0-server flow. If `cancel`, stop.

If they pick a number, **do NOT deploy yet — first confirm the app label** using the same combined prompt as the 1-server branch below (see "Confirm the labels"). Then `save_server_selection` and go to Step 2.

#### 1 server (auto-pick with confirmation)

Combine the server confirmation and the label confirmation into ONE prompt. Look up whether an app with `label === derivedAppLabel` already exists on the server; that changes the wording ("will REDEPLOY to existing app" vs "will CREATE a new app").

```
You have one Cloudways server:
  Server: {label} · {cloud} · {region} · {size} · {appsCount} apps · running (id={serverId})

Cloudways will use this app label for the deploy:
  App label: {derivedAppLabel}     [from folder name{, padded to meet Cloudways' min 3 chars if applicable}]
                                   [MATCHES existing app id={existingAppId} → will REDEPLOY to that app]
                                   OR
                                   [no matching app → will CREATE a new app on this server]

Reply:
  1. Yes, deploy to {label} / {derivedAppLabel}
  2. Change the app label  (I'll ask you for the new label)
  3. Pick a different server  (drops into the 0-server create flow, or 'cancel' to stop)
  4. Cancel
```

- On **1** → `save_server_selection({ serverId, serverLabel, appId? })` (include `appId` if we matched an existing app), then go to Step 2, passing `appNameOverride: derivedAppLabel` to `prepare_config`.
- On **2** → ask "What should the app label be?" and validate against `^[a-z0-9]+(-[a-z0-9]+)*$` (3-60 chars). Re-prompt on invalid input rather than silently mangling. Then re-run the same combined prompt with the new label so the user sees the final state one more time, or skip straight to `save_server_selection` if they already confirmed.
- On **3** → drop into the 0-server flow.
- On **4** or `cancel` → stop cleanly.

#### 0 servers (LLM-driven create flow)

There is no wizard code and no hard-coded default. You walk the user through the Cloudways options using the discovery tools, then create when they confirm.

1. Explain the situation and ask if they want to create a server (~6 min, real cost). If they decline, stop cleanly with a dashboard link: `https://platform.cloudways.com/server/create`.
2. Ask which cloud. Call `list_providers` and show the codes + names.
3. Once they answer, call `list_regions` with the chosen `cloud` and ask which region.
4. Call `list_instance_sizes` with the chosen `cloud` and show the sizes with `ram`, `cpu`, `priceMonthly`. Ask which size.
5. **Derive the labels and always show them for confirmation, with an easy override path.** Cloudways rejects any label under 3 characters (HTTP 422), so `prepare_config`'s `slugify` auto-pads short workspace names with `-app` (e.g. `wp` → `wp-app`). Defaults:
   - `appLabel` = the slugified workspace directory name (auto-padded to ≥ 3 chars).
   - `serverLabel` = `${appLabel}-server`.
   - `projectName` = `appLabel` (unless the user opts to change it).

   Present them to the user like this — never silent:
   ```
   Cloudways will use these labels (visible in the dashboard and in the app URL):

     App label:    my-wp-site         (from folder name)
     Server label: my-wp-site-server  (derived from app label)

   Reply:
     1. Use these
     2. Change them  (I'll ask for each)
     3. Cancel
   ```
   If the derived `appLabel` came from a short/generic folder name (`wp`, `x`, `app`, etc.) or had to be auto-padded, add a short note above the block explaining what happened and gently recommend option 2:
   > "Your workspace folder is `wp`, which is too short for Cloudways (min 3 chars). I padded it to `wp-app`. You'll probably want to change it — pick option 2."

   Both labels MUST match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase alphanumeric segments with single dashes, 3-60 chars). If the user's override doesn't match, re-prompt with the rule stated verbatim — don't silently mangle their input.

6. **Print the full plan back one more time with the price and ETA, then ask for explicit confirmation** before calling `create_server`. Do NOT call `create_server` without an explicit "yes" from the user — this is a money-touching action.
   ```
   About to launch on Cloudways:
     cloud:        do
     region:       nyc3
     size:         1gb  (~$14/mo)
     application:  wordpress
     server label: my-wp-site-server
     app label:    my-wp-site

   This starts billing immediately and takes ~6 minutes. Type 'yes' to launch.
   ```
7. Call `create_server` with the chosen values and `appLabel = {appLabel confirmed in step 5}`. The tool blocks until the server is running. If it times out, tell the user and call it again with the SAME `serverLabel` and `appLabel` (idempotency by label will reattach or reuse).
8. On success, call `save_server_selection` with `serverId` (and `appId` if you have it — Cloudways created the initial app during server launch, so the first deploy can re-use it via `existingAppIdOverride`).
9. If any subsequent call — `prepare_config`, `deploy` — reports a validation error about `appName`/`appLabel` (min 3 chars, must match the regex above), pass `appNameOverride` to `prepare_config` with the label you confirmed in step 5. Don't re-run `create_server` for label issues.

Only proceed to Step 2 after Step 1.5 has produced a `serverId` and `save_server_selection` has succeeded.

### Step 2 — Prepare the deployment

- Call `prepare_config` with the same workspace path (and the `serverId` from Step 1.5 as an explicit override — belt and suspenders, since `prepare_config` also reads the config file). It will:
  - Extract WP env-style constants from `wp-config.php` (`WP_HOME`, `WP_SITEURL`, `WP_DEBUG`, `WP_DEBUG_LOG`, `WP_MEMORY_LIMIT`).
  - Derive `app_name` (slug of the workspace dir; auto-padded with `-app` when the folder name is under 3 chars, so it always meets Cloudways' min 3 rule).
  - Pick `app_type` (`wordpress` or `woocommerce`).
  - Detect Git remote URL + current branch via `git`.
  - Inject `serverId` (and any cached `existingAppId`) from `.deploy-intel/config.json` into the returned `DeployRequest`.
- Print a 4-line plan to the user:
  > 1. App: `{app_name}` ({app_type})
  > 2. Server: `{cloudwaysServerLabel}` (id=`{serverId}`)
  > 3. Git: `{git_url}` @ `{branch}` (or "skipped — no remote" if `gitReady=false`)
  > 4. Env: {N} vars surfaced

- If the auto-derived `app_name` looks trivial or padded (e.g. `wp-app` from a folder called `wp`), mention it explicitly and offer to override:
  > "I'll use `wp-app` as the Cloudways app label. Say 'call it X' to override before I deploy."
  On override, re-call `prepare_config` with `appNameOverride: "X"` (must match `^[a-z0-9]+(-[a-z0-9]+)*$`, 3-60 chars).
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
- Never modify the user's workspace files — except for `save_server_selection` (writes `.deploy-intel/config.json` + `.gitignore`) and `scaffold_wp_theme` (creates the theme files it advertises).
- Never paste Cloudways API keys into the chat or logs — they live in the backend `.env`.
- If any tool returns an error, surface it and stop. Do not retry blindly.
- **Never call `create_server` without an explicit "yes" from the user in the same turn.** It launches a real, billable server. Reprint the full plan (cloud, region, size, price, label, ETA) and wait for a positive confirmation. "Sounds good", "ok", "sure" all count; silence, "maybe", or requests to change something do not.
- If the user says "switch server", "pick another server", "wrong server", or similar at any point, treat that as a Step 1.5 restart: re-run `list_servers` and the picker, then `save_server_selection` again (overwriting the config file), then continue where you were.
- Idempotency: `create_server` uses `serverLabel` as the dedup key. On any retry, pass the SAME `serverLabel` — the backend will reuse an already-created server instead of billing a duplicate.

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
