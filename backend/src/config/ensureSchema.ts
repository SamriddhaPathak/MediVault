import { execFileSync } from "child_process";
import { prisma } from "./prisma";
import { env } from "./env";
import { logger } from "../utils/logger";

/**
 * Verifies the physical database actually has the columns the Prisma
 * schema expects, and — outside production — applies pending migrations
 * automatically if it doesn't.
 *
 * Why this exists: `prisma migrate dev` must be re-run by hand after any
 * schema change. Skip that step and the app still starts fine, because
 * nothing checks column presence at boot — but the *first* query against
 * the drifted table throws a driver-level "no such column" error deep
 * inside an ordinary request. That reached the user as a bare
 * "Something went wrong. Please try again." on the Upload screen, with
 * nothing in the UI hinting that the fix was a one-line migrate command.
 * `tests/setup.ts` already runs `prisma migrate deploy` before the test
 * suite for exactly this reason; this applies the same fix to `npm run dev`.
 *
 * Deliberately conservative:
 *  - Only ever runs `migrate deploy` (applies checked-in migrations that
 *    exist on disk) — never `migrate dev` and never touches schema.prisma.
 *    It cannot invent a migration; it can only apply ones already committed.
 *  - Auto-applies only outside production. A production deploy should
 *    apply migrations as a deliberate, observed step; this fails loudly and
 *    refuses to serve traffic instead of silently altering a production
 *    database on process boot.
 *  - The probe query only inspects known-recent columns rather than every
 *    field in the schema, so this stays cheap and self-contained.
 */
export async function ensureSchemaIsCurrent(): Promise<void> {
  const isCurrent = await schemaMatchesDatabase();
  if (isCurrent) return;

  if (env.nodeEnv === "production") {
    logger.error(
      "Database schema is out of date. Run `npm run prisma:deploy` (prisma migrate deploy) before starting in production."
    );
    process.exit(1);
  }

  logger.warn("Database schema is out of date; applying pending migrations automatically.");
  try {
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
  } catch (err) {
    logger.error("Automatic migration failed", { error: err instanceof Error ? err.message : String(err) });
    logger.error("Run `npm run prisma:deploy` by hand, then restart the server.");
    process.exit(1);
  }

  // Prisma Client's query engine does not need restarting after the
  // underlying SQLite file gains columns, but re-checking confirms the
  // migration actually fixed things rather than assuming it did.
  const fixed = await schemaMatchesDatabase();
  if (!fixed) {
    logger.error(
      "Migrations were applied but the schema still does not match. Delete dev.db and re-run `npm run prisma:migrate` if this is a disposable local database, or investigate manually otherwise."
    );
    process.exit(1);
  }

  logger.info("Database schema is now up to date.");
}

async function schemaMatchesDatabase(): Promise<boolean> {
  try {
    // A cheap, zero-row probe: selecting a column that doesn't physically
    // exist throws immediately, before Prisma even needs a matching row.
    await prisma.report.findFirst({
      select: { id: true, processingNotice: true, ocrAttempts: true, fileHash: true },
    });
    await prisma.healthProfile.findFirst({ select: { id: true, profilePhotoKey: true } });
    return true;
  } catch (err) {
    logger.warn("Schema probe failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
