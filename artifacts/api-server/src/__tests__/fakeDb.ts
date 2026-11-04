// A small in-memory stand-in for the Drizzle query chain, for route tests
// that need filtering by column. Only the pieces the routes under test use:
// select().from(t).where(...).orderBy()/groupBy()/limit(), awaited.
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

/** db.select() over `rows[tableName]`, honoring where() filters. */
export function fakeDb(rows: Record<string, Row[]>) {
  const query = (tableName: string, filter?: Filter) => {
    const result = () => (rows[tableName] ?? []).filter((r) => matchesFilter(r, filter));
    const q: Record<string, unknown> = {
      where: (f: Filter) => query(tableName, f),
      orderBy: () => q,
      groupBy: () => q,
      limit: () => q,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
    };
    return q;
  };
  return {
    select: () => ({ from: (t: { __name: string }) => query(t.__name) }),
  };
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
  sql: () => ({ op: "any" }),
};
