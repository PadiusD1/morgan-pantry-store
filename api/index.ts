/**
 * Vercel serverless entry — the whole Express API as one function.
 * Static assets and the SPA are served by Vercel's CDN via vercel.json.
 */

import { createApp } from "../server/app";

const app = await createApp();

export default app;
