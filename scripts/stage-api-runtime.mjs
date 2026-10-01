import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "apps/api/dist/main.js");
const target = resolve(root, "dist");

await mkdir(target, { recursive: true });
await rm(resolve(target, "main.js"), { force: true });
await writeFile(
  resolve(target, "index.js"),
  'import { bootstrap } from "../apps/api/dist/main.js";\nbootstrap().catch((error) => {\n  console.error(JSON.stringify({ event: "api_boot_failure", error: error instanceof Error ? error.message : "unknown" }));\n  process.exit(1);\n});\n',
  "utf8",
);

console.log(JSON.stringify({ event: "api_runtime_staged", source, target, entrypoint: resolve(target, "index.js") }));
