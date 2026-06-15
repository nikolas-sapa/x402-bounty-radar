import { handle } from "hono/vercel";
import { buildApp } from "../src/app.js";

export const runtime = "edge";

const app = buildApp();
export default handle(app);
