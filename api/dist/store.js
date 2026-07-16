/**
 * In-memory deployment store. POC-only — process restart loses state.
 *
 * `store.ts` is behind an interface (`DeploymentStore`) so a real backing store
 * (Postgres, Redis, etc.) can be swapped in later without changing routes/orchestrator.
 */
export function createInMemoryStore() {
    const map = new Map();
    return {
        create(initial) {
            const now = Date.now();
            const record = {
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
            const next = {
                ...existing,
                ...patch,
                updatedAt: Date.now(),
            };
            map.set(id, next);
            return next;
        },
    };
}
export function isTerminal(state) {
    return state === "live" || state === "failed";
}
//# sourceMappingURL=store.js.map