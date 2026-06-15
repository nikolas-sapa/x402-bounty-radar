import { serve } from "@hono/node-server";
import { buildApp, config } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

if (!process.env.PAY_TO_ADDRESS) {
  console.warn("WARN: PAY_TO_ADDRESS not set — using burn address; payments cannot be claimed.");
}

const app = buildApp();
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(
    `x402-bounty-radar on :${info.port} | network=${config.NETWORK} | payTo=${config.PAY_TO}`,
  );
});
