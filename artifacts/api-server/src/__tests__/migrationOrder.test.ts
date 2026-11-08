// Guards the order of scripts/migrations/*.sql.
//
// scripts/run-db-migrations.mjs runs these files one by one in filename order
// when the API starts. If a file changes a table (ALTER TABLE) that a later
// file creates (CREATE TABLE), the change fails on a real database, the API
// never starts, and the mocked-database tests never notice. This test reads the
// files in that same order and catches it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/migrations",
);

// Same order as run-db-migrations.mjs: every .sql file, default sort.
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

function tableNames(sql: string, pattern: RegExp): string[] {
  const withoutComments = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(pattern)].map((match) =>
    match[1].replace(/"/g, "").replace(/^public\./i, "").toLowerCase(),
  );
}

const createdIn = (sql: string) =>
  tableNames(sql, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi);
const alteredIn = (sql: string) =>
  tableNames(sql, /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w".]+)/gi);

describe("database migrations", () => {
  it("finds the migration files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never changes a table before the file that creates it has run", () => {
    // Where each table is first created, by position in the run order.
    const firstCreated = new Map<string, number>();
    files.forEach((file, index) => {
      for (const table of createdIn(readFileSync(path.join(migrationsDir, file), "utf8"))) {
        if (!firstCreated.has(table)) firstCreated.set(table, index);
      }
    });

    const problems: string[] = [];
    files.forEach((file, index) => {
      for (const table of alteredIn(readFileSync(path.join(migrationsDir, file), "utf8"))) {
        const createdAt = firstCreated.get(table);
        // Tables no migration creates came from the original schema push, so they already exist.
        if (createdAt !== undefined && createdAt > index) {
          problems.push(`${file} changes "${table}", which is only created later in ${files[createdAt]}`);
        }
      }
    });

    expect(problems).toEqual([]);
  });
});
