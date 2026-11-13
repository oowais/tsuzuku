import { sql } from "drizzle-orm";
import { useDb } from "../db";
import { API_VERSION } from "../lib/api-version";

// For the container health check: the server answers and the database opens (migrations applied).
// Calls no source. `apiVersion` lets the app see a server it does not match (#108).
export default defineEventHandler(() => {
  useDb().get(sql`select 1`);
  return { ok: true, apiVersion: API_VERSION };
});
