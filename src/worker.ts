import { buildApp } from "./app.js";

// Cloudflare Workers entry. Bridges the Worker `env` bindings into process.env
// (populated by nodejs_compat) so the shared app.ts config reads them, then
// builds the Hono app once and serves it.
let app: ReturnType<typeof buildApp> | undefined;

export default {
  fetch(req: Request, env: Record<string, unknown>, ctx: unknown): Response | Promise<Response> {
    if (!app) {
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === "string") process.env[k] = v;
      }
      app = buildApp();
    }
    // @ts-expect-error Hono's fetch accepts (request, env, ctx) on Workers
    return app.fetch(req, env, ctx);
  },
};
