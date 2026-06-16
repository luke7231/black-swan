#!/usr/bin/env node

const { Client } = require("pg");

const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS || 60_000);
const intervalMs = Number(process.env.DB_WAIT_INTERVAL_MS || 2_000);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const startedAt = Date.now();
  let attempt = 0;
  let lastError = null;

  while (Date.now() - startedAt <= timeoutMs) {
    attempt += 1;

    try {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      console.log(`[db] connected after ${attempt} attempt(s)`);
      return;
    } catch (error) {
      lastError = error;
      console.log(`[db] waiting for database (${attempt}): ${error.message}`);
      await sleep(intervalMs);
    }
  }

  throw new Error(`Database was not reachable within ${timeoutMs}ms: ${lastError ? lastError.message : "unknown error"}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
