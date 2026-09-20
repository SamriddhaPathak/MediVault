import { execFileSync } from "child_process";

// Ensures tests use a disposable SQLite file and short JWT-secret values,
// independent of whatever .env is configured for local dev.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "file:./test.db";
process.env.JWT_ACCESS_SECRET = "test_access_secret";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
process.env.STORAGE_LOCAL_DIR = "./test-uploads";

// Jest used to point Prisma at test.db without applying migrations first,
// leaving the suite to fail with "table User does not exist" on a fresh run.
// Deploying the checked-in migrations keeps the test database disposable and
// guarantees it matches the application schema.
execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
	cwd: process.cwd(),
	env: process.env,
	stdio: "ignore",
});
