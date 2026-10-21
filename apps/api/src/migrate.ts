import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.ts";
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(93427812)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort()) {
      if ((await client.query("SELECT 1 FROM schema_migration WHERE name=$1", [name])).rowCount)
        continue;
      await client.query(await readFile(new URL(name, dir), "utf8"));
      await client.query("INSERT INTO schema_migration(name) VALUES($1)", [name]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  await pool.end();
  console.log("Migrations applied");
}
