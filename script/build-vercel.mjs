// CI and local production tests execute the exact build configured for Vercel.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
if (typeof config.buildCommand !== "string" || !config.buildCommand.trim()) {
  throw new Error("vercel.json must specify the production buildCommand.");
}
const child = spawn(config.buildCommand, {
  cwd: root,
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PATH: [path.join(root, "node_modules", ".bin"), process.env.PATH || ""].join(path.delimiter),
  },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
