import type { PoolClient } from "pg";
import { inPack, type Pack } from "../../apps/api/src/catalog.ts";
import type { Entity, Movie } from "../../packages/game-engine/src/model.ts";

// One JSON parameter per batch keeps both round trips and parameter counts bounded.
export async function writeCatalog(
  client: PoolClient,
  movies: Movie[],
  packs: Pack[],
  preserve: boolean,
  progress: (message: string) => void = console.log,
) {
  async function write(sql: string, rows: unknown[], label: string) {
    for (let offset = 0; offset < rows.length; offset += 1000) {
      await client.query(sql, [JSON.stringify(rows.slice(offset, offset + 1000))]);
      progress(`${label}: ${Math.min(offset + 1000, rows.length)}/${rows.length}`);
    }
  }
  await write(
    `INSERT INTO content_pack(id,name,description,rules)
     SELECT id,name,description,rules FROM jsonb_to_recordset($1::jsonb)
     AS x(id text,name jsonb,description jsonb,rules jsonb)
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rules=EXCLUDED.rules`,
    packs,
    "Collections",
  );
  await write(
    `INSERT INTO movie(id,title,original_title,titles,release_year,runtime,external_ids,popularity_score,provenance,genre_profile)
     SELECT id,title,original_title,titles,release_year,runtime,external_ids,popularity_score,provenance,genre_profile
     FROM jsonb_to_recordset($1::jsonb) AS x(id text,title text,original_title text,titles jsonb,
       release_year integer,runtime integer,external_ids jsonb,popularity_score real,provenance jsonb,genre_profile jsonb)
     ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,original_title=EXCLUDED.original_title,
       titles=EXCLUDED.titles,release_year=EXCLUDED.release_year,runtime=EXCLUDED.runtime,
       external_ids=EXCLUDED.external_ids,popularity_score=EXCLUDED.popularity_score,
       provenance=EXCLUDED.provenance,genre_profile=EXCLUDED.genre_profile`,
    movies.map((m) => ({
      id: m.id,
      title: m.title,
      original_title: m.originalTitle,
      titles: m.titles,
      release_year: m.releaseYear,
      runtime: m.runtime,
      external_ids: m.externalIds,
      popularity_score: m.popularityScore,
      provenance: m.provenance,
      genre_profile: m.genreProfile ?? null,
    })),
    "Movies",
  );
  const ids = movies.map((m) => m.id);
  for (const table of [
    "alias",
    "movie_person",
    "movie_genre",
    "movie_country",
    "movie_studio",
    "movie_pack",
  ] as const) {
    for (let offset = 0; offset < ids.length; offset += 1000)
      await client.query(`DELETE FROM ${table} WHERE movie_id=ANY($1::text[])`, [
        ids.slice(offset, offset + 1000),
      ]);
  }
  // Fold repeated identities in source order. Updating merges all new localized
  // names; additive imports keep the first new identity and existing DB values.
  function entities(values: Entity[]) {
    const records = new Map<string, Entity>();
    for (const value of values) {
      const previous = records.get(value.id);
      if (!previous || !preserve)
        records.set(value.id, { ...value, names: { ...previous?.names, ...value.names } });
    }
    return [...records.values()];
  }
  for (const [table, values] of [
    ["person", movies.flatMap((m) => [...m.directors, ...m.actors])],
    ["genre", movies.flatMap((m) => [...m.genres, ...(m.subgenres ?? [])])],
    ["country", movies.flatMap((m) => m.countries)],
    ["studio", movies.flatMap((m) => m.studios)],
  ] as const) {
    await write(
      `INSERT INTO ${table}(id,name,names)
       SELECT id,name,names FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,names jsonb)
       ON CONFLICT(id) ${preserve ? "DO NOTHING" : `DO UPDATE SET name=EXCLUDED.name,names=${table}.names || EXCLUDED.names`}`,
      entities(values),
      table,
    );
  }
  await write(
    `INSERT INTO alias(movie_id,name)
     SELECT movie_id,name FROM jsonb_to_recordset($1::jsonb) AS x(movie_id text,name text)
     ON CONFLICT DO NOTHING`,
    movies.flatMap((m) => m.aliases.map((name) => ({ movie_id: m.id, name }))),
    "Aliases",
  );
  await write(
    `INSERT INTO movie_person(movie_id,person_id,role,position)
     SELECT movie_id,person_id,role,position FROM jsonb_to_recordset($1::jsonb)
     AS x(movie_id text,person_id text,role text,position integer) ON CONFLICT DO NOTHING`,
    movies.flatMap((m) =>
      (["director", "actor"] as const).flatMap((role) =>
        (role === "director" ? m.directors : m.actors).map((p, position) => ({
          movie_id: m.id,
          person_id: p.id,
          role,
          position,
        })),
      ),
    ),
    "Cast and directors",
  );
  for (const [table, select] of [
    ["genre", (m: Movie) => [...m.genres, ...(m.subgenres ?? [])]],
    ["country", (m: Movie) => m.countries],
    ["studio", (m: Movie) => m.studios],
  ] as const) {
    await write(
      `INSERT INTO movie_${table}(movie_id,entity_id)
       SELECT movie_id,entity_id FROM jsonb_to_recordset($1::jsonb) AS x(movie_id text,entity_id text)
       ON CONFLICT DO NOTHING`,
      movies.flatMap((m) => select(m).map((e) => ({ movie_id: m.id, entity_id: e.id }))),
      `Movie ${table}`,
    );
  }
  await write(
    `INSERT INTO movie_pack(movie_id,pack_id)
     SELECT movie_id,pack_id FROM jsonb_to_recordset($1::jsonb) AS x(movie_id text,pack_id text)
     ON CONFLICT DO NOTHING`,
    movies.flatMap((m) =>
      packs.filter((p) => inPack(m, p)).map((p) => ({ movie_id: m.id, pack_id: p.id })),
    ),
    "Movie collections",
  );
}
