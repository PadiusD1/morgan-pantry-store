/**
 * Vercel serverless entry (bundled by script/build-api.mjs into api/index.js).
 * The whole Express API is one function; the SPA is served by Vercel's CDN.
 */

import { createApp } from "./app";

const app = await createApp();

export default app;
