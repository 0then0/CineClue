import { pool } from "../apps/api/src/db.ts";
import { lazyFunction } from "../apps/api/src/runtime.ts";

// Read-only against the explicitly selected database. Run in a fresh process.
const handler = lazyFunction();
try {
  const timings = [];
  for (let i = 0; i < 2; i++) {
    const start = performance.now();
    const response = await handler(new Request("https://benchmark.invalid/api/health"), {
      ip: "192.0.2.1",
    });
    if (response.status !== 200) throw new Error(`Health failed: ${response.status}`);
    timings.push(Math.round(performance.now() - start));
  }
  console.log(JSON.stringify({ coldRequestMs: timings[0], warmRequestMs: timings[1] }));
} finally {
  await pool.end();
}
