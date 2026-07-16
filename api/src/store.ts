/**
 * In-memory deployment store. POC-only — process restart loses state.
 *
 * `store.ts` is behind an interface (`DeploymentStore`) so a real backing store
 * (Postgres, Redis, etc.) can be swapped in later without changing routes/orchestrator.
 */

import type { DeploymentState, DeployStatus } from "./types.js";

export interface DeploymentStore {
  create(initial: Omit<DeployStatus, "updatedAt" | "createdAt">): DeployStatus;
  get(id: string): DeployStatus | undefined;
  update(id: string, patch: Partial<Omit<DeployStatus, "deploymentId" | "createdAt">>): DeployStatus;
}

export function createInMemoryStore(): DeploymentStore {
  const map = new Map<string, DeployStatus>();

  return {
    create(initial) {
      const now = Date.now();
      const record: DeployStatus = {
        ...initial,
        createdAt: now,
        updatedAt: now,
      };
      map.set(record.deploymentId, record);
      return record;
    },
    get(id) {
      return map.get(id);
    },
    update(id, patch) {
      const existing = map.get(id);
      if (!existing) {
        throw new Error(`Unknown deployment ${id}`);
      }
      const next: DeployStatus = {
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      };
      map.set(id, next);
      return next;
    },
  };
}

export function isTerminal(state: DeploymentState): boolean {
  return state === "live" || state === "failed";
}
