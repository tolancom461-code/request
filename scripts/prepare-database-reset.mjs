import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  clientFor,
  snapshot,
  saveBackup,
  loadBackup,
  restoreEmpty,
  quote,
  sanitizedFailure,
} from "./database-snapshot.mjs";

const mode = process.argv[2];
const source = clientFor();
let verification;
try {
  if (mode === "backup") {
    const captured = await snapshot(source);
    const result = saveBackup(captured);
    mkdirSync("evidence", { recursive: true });
    writeFileSync(
      "evidence/reset-backup.json",
      JSON.stringify({ ...result, verified: true }, null, 2)
    );
    console.log(
      JSON.stringify({
        event: "encrypted_backup_verified",
        directory: result.directory,
        tableCount: captured.tables.length,
        rowCount: captured.tables.reduce(
          (sum, table) => sum + table.rowCount,
          0
        ),
      })
    );
  } else if (mode === "verification-clone") {
    const data = loadBackup(process.argv[3]);
    const name = `REQUEST_verify_${randomBytes(4).toString("hex")}`;
    await source.$executeRawUnsafe(
      `CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    verification = clientFor(name);
    await restoreEmpty(verification, data);
    writeFileSync(
      "evidence/reset-verification-target.json",
      JSON.stringify(
        { name, backup: process.argv[3], restorationVerified: true },
        null,
        2
      )
    );
    console.log(
      JSON.stringify({
        event: "isolated_backup_restore_verified",
        name,
        tableCount: data.tables.length,
      })
    );
  } else throw new Error("Choose backup or verification-clone.");
} catch (error) {
  console.error(JSON.stringify(sanitizedFailure(error)));
  process.exitCode = 1;
} finally {
  await source.$disconnect();
  await verification?.$disconnect();
}
