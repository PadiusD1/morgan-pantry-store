/** Only the known local development database and fresh E2E databases may be seeded. */
export function localStackDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("DATABASE_URL does not parse"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "localhost" || url.search || url.hash) {
    throw new Error("DATABASE_URL must be literal localhost PostgreSQL without connection overrides");
  }
  const name = url.pathname.slice(1);
  if (name !== "frc_stack" && !/^frc_e2e_[a-z]{16}$/.test(name)) {
    throw new Error("the database name is not an approved synthetic namespace");
  }
  return url;
}
