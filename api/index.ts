import { handle } from "@hono/node-server/vercel";
import { buildApp } from "../src/app.js";

const app = buildApp();
export default handle(app);
