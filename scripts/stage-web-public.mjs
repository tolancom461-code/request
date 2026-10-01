import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("apps/web/dist");
const target = resolve("dist/public");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(JSON.stringify({ event: "web_public_staged", source, target }));
