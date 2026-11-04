// A small in-memory stand-in for the Drizzle query chain, for route tests
// that need filtering by column. Only the pieces the routes under test use:
// select().from(t).where(...).orderBy()/groupBy()/limit(), awaited, plus
// simple insert/delete/transaction and an execute() that returns no rows.
// Pair it with the `drizzleFake` mock of "drizzle-orm" below.

export type Row = Record<string, unknown>;
export type Col = { table: string; col: string };
export type Filter =
  | { op: "and" | "or"; parts: (Filter | undefined)[] }
  | { op: "eq" | "ne"; col: Col; value: unknown }
  | { op: "isNull"; col: Col }
  | { op: "inArray"; col: Col; values: unknown[] }
  | { op: "any" };

export function table(name: string, cols: string[]): Record<string, unknown> {
  const t: Record<string, unknown> = { __name: name };
  for (const c of cols) t[c] = { table: name, col: c };
  return t;
}

export function matchesFilter(row: Row, f: Filter | undefined): boolean {
  if (!f) return true;
  switch (f.op) {
    case "and": return f.parts.every((p) => matchesFilter(row, p));
    case "or": return f.parts.some((p) => matchesFilter(row, p));
    case "eq": return row[f.col.col] === f.value;
    case "ne": return row[f.col.col] !== f.value;
    case "isNull": return row[f.col.col] == null;
    case "inArray": return f.values.includes(row[f.col.col]);
    default: return true;
  }
}

function project(row: Row, fields?: Record<string, unknown>): Row {
  if (!fields) return row;
  const out: Row = {};
  for (const [key, col] of Object.entries(fields)) {
    out[key] = col && typeof col === "object" && "col" in col ? row[(col as Col).col] : undefined;
  }
  return out;
}

/**
 * db.select(fields?) over `rows[tableName]`, honoring where() filters and
 * picked fields; db.update(t).set(v).where(f).returning() edits the rows.
 */
export function fakeDb(rows: Record<string, Row[]>) {
  const query = (tableName: string, fields?: Record<string, unknown>, filter?: Filter) => {
    const result = () => (rows[tableName] ?? []).filter((r) => matchesFilter(r, filter)).map((r) => project(r, fields));
    const q: Record<string, unknown> = {
      where: (f: Filter) => query(tableName, fields, f),
      leftJoin: () => q,
      innerJoin: () => q,
      orderBy: () => q,
      groupBy: () => q,
      limit: () => q,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
    };
    return q;
  };
  const db = {
    select: (fields?: Record<string, unknown>) => ({ from: (t: { __name: string }) => query(t.__name, fields) }),
    /** Raw SQL isn't run; it reads as no rows. */
    execute: async () => ({ rows: [] as Row[] }),
    insert: (t: { __name: string }) => ({
      values: (v: Row | Row[]) => {
        const added = (Array.isArray(v) ? v : [v]).map((one) => {
          const row = { id: (rows[t.__name]?.length ?? 0) + 1000, ...one };
          (rows[t.__name] ??= []).push(row);
          return row;
        });
        return { returning: async () => added, then: (ok: (v: unknown) => unknown) => Promise.resolve(undefined).then(ok) };
      },
    }),
    delete: (t: { __name: string }) => ({
      where: async (f: Filter) => {
        rows[t.__name] = (rows[t.__name] ?? []).filter((r) => !matchesFilter(r, f));
      },
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    update: (t: { __name: string }) => ({
      set: (values: Row) => ({
        where: (f: Filter) => ({
          returning: async () => {
            const hit = (rows[t.__name] ?? []).filter((r) => matchesFilter(r, f));
            for (const r of hit) Object.assign(r, values);
            return hit;
          },
        }),
      }),
    }),
  };
  return db;
}

export const drizzleFake = {
  and: (...parts: Filter[]) => ({ op: "and", parts }),
  or: (...parts: Filter[]) => ({ op: "or", parts }),
  eq: (col: Col, value: unknown) => ({ op: "eq", col, value }),
  ne: (col: Col, value: unknown) => ({ op: "ne", col, value }),
  isNull: (col: Col) => ({ op: "isNull", col }),
  inArray: (col: Col, values: unknown[]) => ({ op: "inArray", col, values }),
  desc: (x: unknown) => x,
  asc: (x: unknown) => x,
  count: () => ({ op: "any" }),
  lte: () => ({ op: "any" }),
  gte: () => ({ op: "any" }),
  isNotNull: () => ({ op: "any" }),
  sql: Object.assign(() => ({ op: "any" }), { raw: () => ({ op: "any" }) }),
};
