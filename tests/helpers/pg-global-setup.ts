import { assertSafeEnv, startServer, stopServer } from "./pg";

/** Vitest globalSetup for the real Postgres suite. */
export default function setup(): () => void {
  assertSafeEnv();
  const started = startServer();
  return () => {
    if (started) stopServer();
  };
}
