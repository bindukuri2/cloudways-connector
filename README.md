# deploy.intel — Cloudways x Cursor POC

Zero-friction WordPress / WooCommerce deployment to Cloudways, driven from Cursor chat.

This repo contains two artifacts that both run locally:

| Path | What | Runs as |
| --- | --- | --- |
| `plugin/` | Cursor Marketplace plugin (`cloudways-deploy`) — skill + rule + MCP server | Spawned by Cursor as a stdio child process |
| `api/` | `deploy-intel-api` — Fastify backend that talks to Cloudways | `npm run dev` on your machine, port 8787 |
| `shared/` | Canonical wire-contract types (`ProjectStack`, `DeployRequest`, `DeployStatus`) | Reference only; each package keeps its own copy |

## End-to-end flow

```text
Cursor chat -> "deploy this WordPress site"
            -> skill cloudways-deploy triggers
            -> MCP tool detect_project    (scans workspace)
            -> MCP tool list_servers      (see Step 1.5 in SKILL.md)
                 -> 0 servers -> list_providers -> list_regions
                              -> list_instance_sizes -> confirm
                              -> create_server (blocking, ~6 min)
                 -> 1 server  -> auto-pick with confirmation
                 -> N servers -> numbered picker
            -> MCP tool save_server_selection  (writes .deploy-intel/config.json)
            -> MCP tool prepare_config    (builds DeployRequest, injects serverId)
            -> MCP tool deploy            (POST localhost:8787/deployments)
                                    -> api: orchestrator
                                          -> Cloudways /oauth/access_token
                                          -> Cloudways /app   (create on the picked server_id)
                                          -> Cloudways /git/clone (if Git ready)
                                          -> resolve canonical app URL
            -> MCP tool status            (poll until live or failed)
            -> "Live at https://..."
```

## Prereqs

- Node.js 20+ (uses native `fetch`).
- A Cloudways account and an API key from <https://platform.cloudways.com/api>.
- That's it — servers are resolved at deploy time. The plugin lists your existing servers or walks you through creating one; the chosen server is cached per workspace in `.deploy-intel/config.json` so the second deploy is one-shot.

## Local dev — first run

### 1. Build the MCP server

```bash
cd plugin/mcp-server
npm install
npm run build
```

For iterative work, leave `npm run watch` running in this terminal.

### 2. Install the plugin into Cursor

```bash
ln -s "$(pwd)/../" "$HOME/.cursor/plugins/local/cloudways-deploy"
```

(Already done if you ran the e2e step in this repo's setup.) Reload the Cursor window: `Cmd+Shift+P` -> "Developer: Reload Window".

### 3. Configure the backend

```bash
cd ../../api
cp .env.example .env
# edit .env — set CLOUDWAYS_EMAIL and CLOUDWAYS_API_KEY
# CLOUDWAYS_SERVER_ID is optional and only used as a fallback when the plugin
# didn't pass a serverId. Leave it commented out for normal use.
npm install
npm run dev
```

You should see `deploy-intel-api up` on port 8787.

### 4. Drive it from Cursor

Open any WordPress / WooCommerce project in Cursor and type, in chat:

> deploy this WordPress site to Cloudways

The `cloudways-deploy` skill should auto-trigger. It will run `detect_project`, surface the detected stack, run `prepare_config`, ask for confirmation if the Git remote is missing, then call `deploy` and stream status until you get a final URL.

## Smoke testing without Cursor

The MCP server speaks plain JSON-RPC over stdio, so you can poke at it directly. A WordPress + WooCommerce fixture and a smoke driver are included:

```bash
./scripts/make-wp-fixture.sh          # creates /tmp/wp-fixture
node scripts/mcp-smoke.mjs            # walks the full handshake + 3 tool calls
```

The smoke script intentionally calls `deploy` with the backend down to verify the MCP server returns a clean error message — no real Cloudways traffic is generated.

For the HTTP side, with the backend running:

```bash
curl -s http://localhost:8787/healthz
```

## Project layout

```text
deploy_intel/
├── plugin/                      # Cursor plugin
│   ├── .cursor-plugin/plugin.json
│   ├── skills/cloudways-deploy/SKILL.md
│   ├── rules/wordpress-deploy.mdc
│   ├── mcp.json                 # spawns the MCP server, sets DEPLOY_INTEL_API_URL
│   └── mcp-server/              # Node + TS MCP server (12 tools)
│       └── src/tools/
│           ├── detect_project.ts, scaffold_wp_theme.ts, prepare_config.ts,
│           ├── deploy.ts, status.ts,
│           ├── list_servers.ts, list_providers.ts, list_regions.ts,
│           ├── list_instance_sizes.ts, list_app_versions.ts,
│           └── create_server.ts, save_server_selection.ts
├── api/                         # Fastify backend
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/{deployments,health,servers}.ts
│   │   ├── orchestrator.ts      # state machine
│   │   ├── store.ts             # in-memory deployment store (POC)
│   │   ├── cloudways/{client,auth,apps,git,cache,servers}.ts
│   │   └── types.ts             # local copy of the shared contract
│   └── .env.example
└── shared/types.ts              # canonical reference for the wire contract
```

## Out of scope (POC)

- Deploying the backend anywhere (Render, Fly, etc.) — backend is local-only.
- Preflight account check (billing / trial status). If `POST /server` is rejected, the error is surfaced verbatim.
- Resuming an in-flight `POST /server` operation across backend restarts.
- User auth, multi-tenant credential storage, billing.
- Persistent deployment state — in-memory only; restart wipes deployments. (Workspace-level server selection IS persisted, in `.deploy-intel/config.json`.)
- Database export/import (fresh WP install only).
