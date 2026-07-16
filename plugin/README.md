# cloudways-deploy (Cursor plugin)

Zero-friction WordPress & WooCommerce deployment to Cloudways from Cursor chat.

This plugin ships a single skill (`cloudways-deploy`) backed by a local MCP server. When the user says something like "deploy this WordPress site", the skill auto-fires, the MCP server detects the stack, and the deployment is handed off to the locally-running `deploy-intel-api` backend (sibling `api/` folder) which talks to the Cloudways Platform API V2.

## Components

| Component | Path | Purpose |
| --- | --- | --- |
| Manifest | `.cursor-plugin/plugin.json` | Plugin identity |
| Skill | `skills/cloudways-deploy/SKILL.md` | Intent trigger + step-by-step driver |
| Rule | `rules/wordpress-deploy.mdc` | WP project guardrails (globbed) |
| MCP config | `mcp.json` | Wires up the local MCP server |
| MCP server | `mcp-server/` | Node + TS, stdio transport, four tools |

## MCP tools

- `detect_project(workspaceRoot: string)` -> `ProjectStack`
- `prepare_config(workspaceRoot: string)` -> `DeployRequest`
- `deploy(request: DeployRequest)` -> `{ deploymentId, statusUrl }`
- `status(deploymentId: string)` -> `DeployStatus`

## Local install

```bash
cd plugin/mcp-server
npm install
npm run build

ln -s "$(cd .. && pwd)" "$HOME/.cursor/plugins/local/cloudways-deploy"
```

Then reload the Cursor window. Make sure the backend (`../api`) is running on `http://localhost:8787`.

## Configuration

The backend URL is read from `DEPLOY_INTEL_API_URL` set in `mcp.json`. Default: `http://localhost:8787`.
