import pg from "pg";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://cineclue:cineclue@localhost:5432/cineclue",
  max: process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
  allowExitOnIdle: true,
});
pool.on("error", (error) => console.error("PostgreSQL pool:", error.message));
