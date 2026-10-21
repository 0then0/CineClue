import { loadCatalog } from "./catalog.ts";
import { pool } from "./db.ts";
import { app } from "./http.ts";
import { readMediaSnapshot } from "./media.ts";

const secret = process.env.DAILY_SECRET;
if (!secret || secret.length < 32)
  throw new Error("DAILY_SECRET must contain at least 32 characters. See .env.example.");
const production = process.env.NODE_ENV === "production";
if (production && !process.env.PUBLIC_ORIGIN?.startsWith("https://"))
  throw new Error("Production requires an HTTPS PUBLIC_ORIGIN");
const server = app(await loadCatalog(), secret, {
  media: await readMediaSnapshot(),
  origin: process.env.PUBLIC_ORIGIN ?? "http://localhost:5173",
  secureCookies: production,
  staticRoot: process.env.STATIC_ROOT,
  trustedProxyIp: process.env.TRUSTED_PROXY_IP,
});
const cleanup = setInterval(() => {
  pool.query("DELETE FROM rate_limit WHERE expires_at<now()").catch(console.error);
}, 60000);
cleanup.unref();
server.listen(Number(process.env.PORT ?? 3001), "0.0.0.0", () =>
  console.log(`CineClue API listening on ${process.env.PORT ?? 3001}`),
);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(cleanup);
    server.close(() => {
      pool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
