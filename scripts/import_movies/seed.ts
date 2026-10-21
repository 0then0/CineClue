import { inPack, loadCatalog } from "../../apps/api/src/catalog.ts";
import { pool } from "../../apps/api/src/db.ts";
import { migrate } from "../../apps/api/src/migrate.ts";
import { readSnapshot } from "./snapshot.ts";

await migrate();
if (
  process.argv.includes("--if-empty") &&
  (await pool.query("SELECT 1 FROM movie LIMIT 1")).rowCount
) {
  console.log("Catalog already initialized");
  await pool.end();
  process.exit(0);
}
const { movies, packs } = await readSnapshot();
const preserve = process.argv.includes("--preserve-existing");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(93427813)");
  if ((await client.query("SELECT 1 FROM movie LIMIT 1")).rowCount) {
    const old = await loadCatalog();
    for (const table of ["daily_puzzle", "game_session"] as const) {
      const targets = (
        await client.query(`SELECT DISTINCT target_id FROM ${table} WHERE target_snapshot IS NULL`)
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
  for (const p of packs)
    await client.query(
      "INSERT INTO content_pack(id,name,description,rules) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,rules=$4",
      [p.id, p.name, p.description, p.rules],
    );
  const existing = preserve
    ? new Set<string>((await client.query("SELECT id FROM movie")).rows.map((r) => r.id))
    : new Set<string>();
  let added = 0;
  for (const m of movies) {
    if (existing.has(m.id)) continue;
    added++;
    await client.query(
      "INSERT INTO movie(id,title,original_title,titles,release_year,runtime,external_ids,popularity_score,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET title=$2,original_title=$3,titles=$4,release_year=$5,runtime=$6,external_ids=$7,popularity_score=$8,provenance=$9",
      [
        m.id,
        m.title,
        m.originalTitle,
        m.titles,
        m.releaseYear,
        m.runtime,
        m.externalIds,
        m.popularityScore,
        JSON.stringify(m.provenance),
      ],
    );
    await client.query("DELETE FROM alias WHERE movie_id=$1", [m.id]);
    for (const name of m.aliases)
      await client.query("INSERT INTO alias VALUES($1,$2) ON CONFLICT DO NOTHING", [m.id, name]);
    await client.query("DELETE FROM movie_person WHERE movie_id=$1", [m.id]);
    for (const [role, people] of [
      ["director", m.directors],
      ["actor", m.actors],
    ] as const) {
      for (const [position, p] of people.entries()) {
        await client.query(
          `INSERT INTO person(id,name,names) VALUES($1,$2,$3) ON CONFLICT(id) ${preserve ? "DO NOTHING" : "DO UPDATE SET name=$2,names=person.names || EXCLUDED.names"}`,
          [p.id, p.name, p.names],
        );
        await client.query("INSERT INTO movie_person VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [
          m.id,
          p.id,
          role,
          position,
        ]);
      }
    }
    for (const [table, values] of [
      ["genre", m.genres],
      ["country", m.countries],
      ["studio", m.studios],
    ] as const) {
      await client.query(`DELETE FROM movie_${table} WHERE movie_id=$1`, [m.id]);
      for (const e of values) {
        await client.query(
          `INSERT INTO ${table}(id,name,names) VALUES($1,$2,$3) ON CONFLICT(id) ${preserve ? "DO NOTHING" : `DO UPDATE SET name=$2,names=${table}.names || EXCLUDED.names`}`,
          [e.id, e.name, e.names],
        );
        await client.query(`INSERT INTO movie_${table} VALUES($1,$2) ON CONFLICT DO NOTHING`, [
          m.id,
          e.id,
        ]);
      }
    }
    await client.query("DELETE FROM movie_pack WHERE movie_id=$1", [m.id]);
    for (const p of packs.filter((p) => inPack(m, p)))
      await client.query("INSERT INTO movie_pack VALUES($1,$2)", [m.id, p.id]);
  }
  await client.query("COMMIT");
  console.log(
    `Seeded ${added} films and ${packs.length} packs; preserved ${movies.length - added} existing films.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
