import { spawn } from "node:child_process";

// Node loads the same local environment for API, migrations and seed commands.
try {
  process.loadEnvFile(".env");
} catch {
  console.log("Using environment variables; copy .env.example to .env for local defaults.");
}
if (!process.env.DAILY_SECRET)
  process.env.DAILY_SECRET = "local-development-only-replace-this-with-32-random-bytes";
const watchArgs =
  process.env.API_WATCH === "0"
    ? []
    : ["--watch", "--watch-path=apps/api/src", "--watch-path=packages/game-engine/src"];
const api = spawn(process.execPath, [...watchArgs, "apps/api/src/server.ts"], {
  stdio: "inherit",
  env: process.env,
});
const web = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"],
  { stdio: "inherit" },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
api.on("exit", (code) => stop(code ?? 1));
web.on("exit", (code) => stop(code ?? 1));
