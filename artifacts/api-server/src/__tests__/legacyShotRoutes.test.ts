import { describe, it, expect, vi } from "vitest";
import express from "express";
import supertest from "supertest";

// D30: the legacy shot upload and stats routes (/api/shots/*) are gone. The
// app records through Ball Boi sessions (/api/ball-boi/*) and never called
// them. This mounts the real API router, so a route that still answered under
// /api/shots would show up here.

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: "user_me" }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage", () => ({ ObjectStorageService: class {}, ObjectNotFoundError: class extends Error {} }));
vi.mock("../lib/objectStorage.js", () => ({ ObjectStorageService: class {}, ObjectNotFoundError: class extends Error {} }));

const db = {
  select: vi.fn(() => {
    throw new Error("No database in this test");
  }),
  execute: vi.fn(async () => ({ rows: [] })),
};
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db };
});

async function app() {
  const { default: router } = await import("../routes/index.js");
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return supertest(a);
}

const legacy: [string, string][] = [
  ["post", "/api/shots/upload-url"],
  ["post", "/api/shots/1/confirm"],
  ["post", "/api/shots/1/ml-callback"],
  ["get", "/api/shots"],
  ["get", "/api/shots/1"],
  ["get", "/api/shots/1/status"],
  ["delete", "/api/shots/1"],
  ["get", "/api/shots/stats/me"],
];

describe("legacy shot routes (D30)", () => {
  it("the API still answers on a live route, so a 404 below means the route is gone", async () => {
    const res = await (await app()).get("/api/healthz");
    expect(res.status).toBe(200);
  });

  it.each(legacy)("%s %s no longer answers", async (method, path) => {
    const res = await (await app())[method as "get" | "post" | "delete"](path).send({ fileName: "a.mp4", contentType: "video/mp4" });
    expect(res.status).toBe(404);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
