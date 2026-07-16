/**
 * deploy-intel-api — local POC backend that talks to Cloudways.
 *
 *   - Reads CLOUDWAYS_* creds from api/.env (via dotenv).
 *   - Exposes POST /deployments, GET /deployments/:id, GET /healthz.
 *   - Stores deployments in-process; restarting the server wipes state.
 *
 * Run with `npm run dev` (tsx watch) for local dev.
 */

import Fastify from "fastify";

import { loadConfig } from "./config.js";
import { createInMemoryStore } from "./store.js";
import { createCloudwaysClient } from "./cloudways/client.js";
import { registerDeploymentRoutes } from "./routes/deployments.js";
import { registerHealthRoutes } from "./routes/health.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  const store = createInMemoryStore();
  const cloudways = createCloudwaysClient({
    apiBaseUrl: config.cloudways.apiBaseUrl,
    email: config.cloudways.email,
    apiKey: config.cloudways.apiKey,
  });

  await registerHealthRoutes(app);
  await registerDeploymentRoutes(app, { cloudways, store, config });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { port: config.port, host: config.host, serverId: config.cloudways.serverId },
    "deploy-intel-api up",
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  // Plain console.error in case Fastify never initialized.
  console.error("[deploy-intel-api] fatal:", msg);
  process.exit(1);
});
