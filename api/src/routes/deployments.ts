import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import type { CloudwaysClient } from "../cloudways/client.js";
import type { DeploymentStore } from "../store.js";
import { runDeployment } from "../orchestrator.js";
import type {
  DeployCreatedResponse,
  DeployRequest,
  DeployStatus,
} from "../types.js";

const projectStackSchema = z
  .object({
    framework: z.enum(["wordpress", "wordpress-bedrock", "static-landing", "unknown"]),
    hasWooCommerce: z.boolean(),
    phpVersion: z.string(),
    theme: z.object({ name: z.string(), slug: z.string() }).optional(),
    plugins: z.array(z.object({ slug: z.string(), name: z.string().optional() })).default([]),
    evidence: z.array(z.object({ signal: z.string(), path: z.string() })).default([]),
    workspaceRoot: z.string(),
  })
  .strict();

const gitSourceSchema = z
  .object({
    gitReady: z.boolean(),
    gitUrl: z.string().optional(),
    branch: z.string().optional(),
    dirty: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict();

const envVarSchema = z
  .object({
    key: z.string(),
    value: z.string().optional(),
    redacted: z.boolean().optional(),
    source: z.enum(["wp-config.php", ".env.example", ".env", "default"]),
  })
  .strict();

const deployRequestSchema = z
  .object({
    appName: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/, "appName must be lowercase alphanumeric/dash"),
    appType: z.enum(["wordpress", "woocommerce"]),
    stack: projectStackSchema,
    git: gitSourceSchema,
    envVars: z.array(envVarSchema).default([]),
    existingAppId: z.string().min(1).optional(),
  })
  .strict();

export interface DeploymentRoutesDeps {
  cloudways: CloudwaysClient;
  store: DeploymentStore;
  config: AppConfig;
}

export async function registerDeploymentRoutes(
  app: FastifyInstance,
  deps: DeploymentRoutesDeps,
): Promise<void> {
  app.post("/deployments", async (request, reply) => {
    const parsed = deployRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: "Invalid DeployRequest",
        issues: parsed.error.flatten(),
      };
    }
    const body: DeployRequest = parsed.data;
    const deploymentId = randomUUID();

    const initial = deps.store.create({
      deploymentId,
      state: "pending",
      message: "Queued",
    });

    setImmediate(() => {
      void runDeployment(deploymentId, body, {
        cloudways: deps.cloudways,
        store: deps.store,
        config: deps.config,
        log: request.log,
      });
    });

    const resp: DeployCreatedResponse = {
      deploymentId,
      statusUrl: `/deployments/${deploymentId}`,
    };
    reply.code(202);
    request.log.info({ deploymentId, initialState: initial.state }, "deploy.queued");
    return resp;
  });

  app.get<{ Params: { id: string } }>("/deployments/:id", async (request, reply) => {
    const { id } = request.params;
    const found = deps.store.get(id);
    if (!found) {
      reply.code(404);
      return { error: `Unknown deployment ${id}` };
    }
    const out: DeployStatus = found;
    return out;
  });
}
