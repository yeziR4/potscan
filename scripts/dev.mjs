// Runs the API server and the Vite dev server together; Ctrl+C stops both.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (workspace, script, env = {}) =>
  spawn("npm", ["run", script, "-w", workspace], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });

// The API port must match the proxy in packages/web/vite.config.ts, whatever PORT the caller set.
const children = [run("@potscan/server", "start", { PORT: "8787" }), run("@potscan/web", "dev")];
const stop = () => children.forEach(child => child.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach(child => child.on("exit", stop));
