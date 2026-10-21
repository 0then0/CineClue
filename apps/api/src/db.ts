import pg from "pg";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://cineclue:cineclue@localhost:5432/cineclue",
  max: 10,
});
pool.on("error", (error) => console.error("PostgreSQL pool:", error.message));
