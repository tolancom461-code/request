import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required for Prisma commands.");
  process.exit(1);
}

const secureUrl = databaseUrl.includes("sslaccept=")
  ? databaseUrl
  : `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}sslaccept=strict`;

const result = spawnSync("pnpm", ["exec", "prisma", ...process.argv.slice(2)], {
  env: { ...process.env, DATABASE_URL: secureUrl },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
