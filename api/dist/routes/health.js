export async function registerHealthRoutes(app) {
    app.get("/healthz", async () => ({ ok: true }));
}
//# sourceMappingURL=health.js.map