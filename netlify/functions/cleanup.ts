import { pool } from "../../apps/api/src/db.ts";

export default async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const result = await pool.query("DELETE FROM rate_limit WHERE expires_at<now()");
  console.log(JSON.stringify({ event: "rate_limits_cleaned", rows: result.rowCount }));
};

// UTC. Expired rows never affect a new minute's quota; daily deletion is enough.
export const config = { schedule: "15 4 * * *" };
