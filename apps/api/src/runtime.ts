import { resolve } from "node:path";
import { loadCatalog } from "./catalog.ts";
import { createHandler } from "./http.ts";
import { readMediaSnapshot } from "./media.ts";

export async function initializeFunction() {
  const secret = process.env.DAILY_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("DAILY_SECRET must contain at least 32 characters");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const origin = process.env.PUBLIC_ORIGIN;
  if (!origin || new URL(origin).origin !== origin || !origin.startsWith("https://"))
    throw new Error("Functions require an exact HTTPS PUBLIC_ORIGIN");
  const started = performance.now();
  const [catalog, media] = await Promise.all([
    loadCatalog(),
    readMediaSnapshot(resolve("data/media.json")),
  ]);
  const handle = createHandler(catalog, secret, { media, origin, secureCookies: true });
  console.log(
    JSON.stringify({
      event: "api_initialized",
      movies: catalog.movies.length,
      durationMs: Math.round(performance.now() - started),
      rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    }),
  );
  return handle;
}

// Concurrent cold requests share initialization. A failed database wake-up may
// be retried on the next invocation instead of poisoning the warm instance.
export function lazyFunction(initialize = initializeFunction) {
  let pending: ReturnType<typeof initialize> | undefined;
  return async (request: Request, context: { ip: string }) => {
    try {
      pending ??= initialize().catch((error) => {
        pending = undefined;
        throw error;
      });
      return await (await pending)(request, context.ip);
    } catch (error) {
      console.error(error);
      return Response.json(
        { error: "internal_error" },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  };
}
