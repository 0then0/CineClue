import { loadCatalog } from "../../apps/api/src/catalog.ts";
import { pool } from "../../apps/api/src/db.ts";
import { migrate } from "../../apps/api/src/migrate.ts";
import { writeCatalog } from "./seed-catalog.ts";
import { readSnapshot } from "./snapshot.ts";

await migrate();
const { movies, packs } = await readSnapshot();
const preserve = process.argv.includes("--preserve-existing");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  console.log("Waiting for catalog import lock");
  await client.query("SELECT pg_advisory_xact_lock(93427813)");
  console.log("Catalog import lock acquired");
  const populated = (await client.query("SELECT 1 FROM movie LIMIT 1")).rowCount;
  if (process.argv.includes("--if-empty") && populated) {
    await client.query("COMMIT");
    console.log("Catalog already initialized");
  } else {
    if (populated) {
      const old = await loadCatalog();
      for (const table of ["daily_puzzle", "game_session"] as const) {
        const targets = (
          await client.query(
            `SELECT DISTINCT target_id FROM ${table} WHERE target_snapshot IS NULL`,
          )
        ).rows;
        for (const { target_id } of targets) {
          const target = old.byId.get(target_id);
          if (!target) throw new Error("Cannot preserve missing target");
          await client.query(
            `UPDATE ${table} SET target_snapshot=$2 WHERE target_id=$1 AND target_snapshot IS NULL`,
            [target_id, JSON.stringify(target)],
          );
        }
      }
    }
    const existing = preserve
      ? new Set<string>((await client.query("SELECT id FROM movie")).rows.map((r) => r.id))
      : new Set<string>();
    const selected = movies.filter((m) => !existing.has(m.id));
    const started = performance.now();
    await writeCatalog(client, selected, packs, preserve);
    console.log("Refreshing catalog planner statistics");
    await client.query(
      "ANALYZE movie,alias,person,genre,country,studio,movie_person,movie_genre,movie_country,movie_studio,content_pack,movie_pack",
    );
    await client.query("COMMIT");
    console.log(
      `Seeded ${selected.length} films and ${packs.length} packs; preserved ${movies.length - selected.length} existing films.`,
    );
    console.log(`Import committed in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
