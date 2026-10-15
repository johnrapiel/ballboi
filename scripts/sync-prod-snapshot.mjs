import { createRequire } from "node:module";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Client } = require("pg");

const PROD_DATABASE_URL = process.env.PROD_DATABASE_URL;
const DEV_DATABASE_URL = process.env.DATABASE_URL;

if (!PROD_DATABASE_URL) {
  console.error(
    "Error: PROD_DATABASE_URL is not set.\n" +
    "Add it as a secret in the Replit Secrets panel (the lock icon in the sidebar).\n" +
    "Its value should be the production PostgreSQL connection string."
  );
  process.exit(1);
}

if (!DEV_DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set. Cannot connect to the dev database.");
  process.exit(1);
}

const TABLES_IN_DEPENDENCY_ORDER = [
  "leagues",
  "courts",
  "players",
  "users",
  "league_invites",
  "player_availability",
  "matches",
  "comments",
  "ball_boi_sessions",
  "match_shots",
  "match_statistics",
];

const TABLES_IN_REVERSE_ORDER = [...TABLES_IN_DEPENDENCY_ORDER].reverse();

const prod = new Client({ connectionString: PROD_DATABASE_URL });
const dev = new Client({ connectionString: DEV_DATABASE_URL });

await prod.connect();
await dev.connect();

console.log("Connected to both databases.");

try {
  console.log("Truncating dev tables (in reverse dependency order)...");
  await dev.query("BEGIN");
  for (const table of TABLES_IN_REVERSE_ORDER) {
    await dev.query(`TRUNCATE TABLE "${table}" CASCADE`);
    console.log(`  Truncated: ${table}`);
  }
  await dev.query("COMMIT");
  console.log("Truncation complete.\n");

  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    const { rows } = await prod.query(`SELECT * FROM "${table}"`);
    if (rows.length === 0) {
      console.log(`Skipping ${table} (no rows in production).`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const columnList = columns.map((c) => `"${c}"`).join(", ");

    let inserted = 0;
    await dev.query("BEGIN");
    try {
      for (const row of rows) {
        const values = columns.map((c) => row[c]);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
        await dev.query(
          `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
        inserted++;
      }
      await dev.query("COMMIT");
      console.log(`Copied ${inserted}/${rows.length} rows into ${table}.`);
    } catch (err) {
      await dev.query("ROLLBACK");
      throw err;
    }
  }

  console.log("\nResetting dev sequences to avoid ID collisions on future inserts...");
  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    const seqResult = await dev.query(
      `SELECT pg_get_serial_sequence($1, 'id') AS seq`,
      [table]
    );
    const seq = seqResult.rows[0]?.seq;
    if (!seq) continue;
    await dev.query(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`,
      [seq]
    );
    console.log(`  Reset sequence for ${table}.`);
  }

  console.log("\nSync complete. Dev database now contains a snapshot of production data.");
} finally {
  await prod.end();
  await dev.end();
}
