import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { MemoryDoublesRepo } from "./doublesMemoryRepo";
import { pairKey } from "../lib/pairing";

// Doubles partners (doubles flow review, John, Nov 9): D2, D4, D9.

let mockUserId: string | null = "u1";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../lib/leagueAccess.js", () => ({ getLeagueRole: async () => null }));
vi.mock("../services/doublesChat.js", () => ({
  openDoublesMatchChat: vi.fn(),
  DoublesChatError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../lib/doublesPartnersRepo.js", () => ({ DrizzleDoublesPartnersRepo: class {} }));

import { DoublesPartnersService, PartnersError } from "../services/doublesPartners";
import { createDoublesPartnersRouter } from "../routes/doublesPartners";

const H = 3_600_000;
let now = new Date("2026-11-10T12:00:00Z");
let repo: MemoryDoublesRepo;
let pushes: { to: string[]; title: string; body: string }[];
let svc: DoublesPartnersService;

function member(id: number, level = 3.5, extra: Partial<{ leagueId: number; name: string; clerkUserId: string | null }> = {}) {
  return { id, name: extra.name ?? `Player ${id}`, level, lookingForPartnerAt: null, clerkUserId: extra.clerkUserId === undefined ? `u${id}` : extra.clerkUserId, leagueId: extra.leagueId ?? 1 };
}

beforeEach(() => {
  now = new Date("2026-11-10T12:00:00Z");
  repo = new MemoryDoublesRepo();
  repo.leagues = [{ id: 1, name: "Thursday Doubles", leagueType: "doubles", partnerMode: "fixed", visibility: "private", endedAt: null }];
  repo.people = [member(1, 3.0, { name: "John Rapiel" }), member(2, 3.5, { name: "Sam Lee" }), member(3, 4.0, { name: "Jo Park" }), member(4, 4.5, { name: "Lee King" })];
  repo.adminIds.set(1, ["admin"]);
  pushes = [];
  svc = new DoublesPartnersService(repo, async (to, title, body) => void pushes.push({ to, title, body }), () => now);
});

async function refused(p: Promise<unknown>): Promise<PartnersError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PartnersError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("D9: Team up with someone", () => {
  it("sends a request with Accept and Decline, 48 hours to answer, and tells the other player", async () => {
    const view = await svc.request(1, "u1", 2);
    expect(view.outgoing).toMatchObject({ to: { playerId: 2, name: "Sam Lee" }, expiresAt: new Date(now.getTime() + 48 * H).toISOString() });
    expect(pushes[0]).toMatchObject({ to: ["u2"], title: "Team up?" });
    expect(pushes[0].body).toContain("48 hours");
    const theirs = await svc.mine(1, "u2");
    expect(theirs.incoming).toHaveLength(1);
    expect(theirs.incoming[0].from.name).toBe("John Rapiel");
  });

  it("Accept makes the team, takes both off the list and ends other requests to them with a notice", async () => {
    await svc.setLooking(1, "u3", true);
    await svc.request(1, "u3", 2);
    await svc.request(1, "u1", 4);
    // Sam takes a request from John... John asked Lee, so Sam asks nobody; Jo asked Sam.
    const sam = await svc.mine(1, "u2");
    const fromJo = sam.incoming[0];
    // Lee accepts John.
    const lee = await svc.mine(1, "u4");
    const after = await svc.respond(1, "u4", lee.incoming[0].requestId, true);
    expect(after.partner).toMatchObject({ playerId: 1, name: "John Rapiel" });
    expect(repo.teamRows).toHaveLength(1);
    expect(pushes.some((p) => p.to[0] === "u1" && p.title === "You're teamed up")).toBe(true);
    // Sam accepts Jo: Jo was on the list and comes off it.
    await svc.respond(1, "u2", fromJo.requestId, true);
    expect(repo.people.find((p) => p.id === 3)!.lookingForPartnerAt).toBeNull();
    expect(repo.teamRows).toHaveLength(2);
  });

  it("a request to someone who teams up with another player ends as taken, with a notice in words", async () => {
    repo.people.push(member(5, 3.5, { name: "Ana Diaz" }));
    await svc.request(1, "u5", 2);
    await svc.request(1, "u1", 3);
    const sam = await svc.request(1, "u2", 4); // Sam asks Lee; Ana is waiting on Sam
    expect(sam.outgoing).not.toBeNull();
    const lee = await svc.mine(1, "u4");
    await svc.respond(1, "u4", lee.incoming[0].requestId, true);
    const ana = await svc.mine(1, "u5");
    expect(ana.looking).toBe(true);
    expect(ana.notice?.text).toBe("Sam Lee teamed up with someone else. You're back on Looking for a partner, so your admin can team you up.");
    expect(pushes.some((p) => p.to[0] === "u5" && p.body.startsWith("Sam Lee teamed up"))).toBe(true);
  });

  it("Decline puts the sender back on Looking for a partner with a notice they can dismiss", async () => {
    await svc.request(1, "u1", 2);
    const sam = await svc.mine(1, "u2");
    await svc.respond(1, "u2", sam.incoming[0].requestId, false);
    const john = await svc.mine(1, "u1");
    expect(john.looking).toBe(true);
    expect(john.outgoing).toBeNull();
    expect(john.notice?.text).toBe("Sam Lee can't team up this season. You're back on Looking for a partner, so your admin can team you up.");
    const dismissed = await svc.dismissNotice(1, "u1", john.notice!.requestId);
    expect(dismissed.notice).toBeNull();
    expect(dismissed.looking).toBe(true);
  });

  it("unanswered after 48 hours expires: the sender is back on the list with a notice, and Accept no longer works", async () => {
    await svc.request(1, "u1", 2);
    const sam = await svc.mine(1, "u2");
    now = new Date(now.getTime() + 48 * H);
    const err = await refused(svc.respond(1, "u2", sam.incoming[0].requestId, true));
    expect(err.status).toBe(409);
    const john = await svc.mine(1, "u1");
    expect(john.looking).toBe(true);
    expect(john.notice?.text).toBe("Sam Lee didn't answer your request in 48 hours. You're back on Looking for a partner, so your admin can team you up.");
    expect(repo.teamRows).toHaveLength(0);
  });

  it("the hourly job expires stale requests across leagues and tells the senders", async () => {
    await svc.request(1, "u1", 2);
    now = new Date(now.getTime() + 47 * H);
    expect(await svc.expireRequests()).toBe(0);
    now = new Date(now.getTime() + 2 * H);
    expect(await svc.expireRequests()).toBe(1);
    expect(repo.requestRows[0].status).toBe("expired");
    expect(pushes.some((p) => p.to[0] === "u1" && p.body.includes("48 hours"))).toBe(true);
  });

  it("blocked players can't request each other and never see each other on the list", async () => {
    repo.blocks.add(pairKey(1, 2));
    const john = await svc.mine(1, "u1");
    expect(john.candidates.map((c) => c.playerId)).toEqual([3, 4]);
    const err = await refused(svc.request(1, "u1", 2));
    expect(err.status).toBe(404);
    expect(err.message).toBe("This player isn't available to team up.");
    expect(pushes).toHaveLength(0);
  });

  it("one request out at a time; asking someone who already asked you points to Accept", async () => {
    await svc.request(1, "u1", 2);
    expect((await refused(svc.request(1, "u1", 3))).message).toMatch(/already have a request out/);
    expect((await refused(svc.request(1, "u2", 1))).message).toMatch(/already asked you/);
  });

  it("closes when the first round goes out: the admin teams people up from then on", async () => {
    repo.published.add(1);
    const john = await svc.mine(1, "u1");
    expect(john.teamingOpen).toBe(false);
    expect(john.candidates).toEqual([]);
    expect((await refused(svc.request(1, "u1", 2))).message).toMatch(/first round went out/);
    expect((await refused(svc.setLooking(1, "u1", true))).message).toMatch(/first round went out/);
  });

  it("only applies to fixed-partner doubles leagues", async () => {
    repo.leagues[0].partnerMode = "rotating";
    const view = await svc.mine(1, "u1");
    expect(view.fixedPartners).toBe(false);
    expect((await refused(svc.request(1, "u1", 2))).status).toBe(409);
  });

  it("Cancel withdraws your own request without a notice", async () => {
    const view = await svc.request(1, "u1", 2);
    const after = await svc.cancel(1, "u1", view.outgoing!.requestId);
    expect(after.outgoing).toBeNull();
    expect(after.notice).toBeNull();
    expect((await svc.mine(1, "u2")).incoming).toEqual([]);
  });
});

describe("D9: Find me a partner", () => {
  it("adds you to the list the admin sees in Manage, by level, and tells the admin", async () => {
    await svc.setLooking(1, "u1", true);
    await svc.setLooking(1, "u4", true);
    const manage = await svc.manage(1);
    expect(manage.unpaired.filter((u) => u.kind === "looking").map((u) => u.name)).toEqual(["Lee King", "John Rapiel"]);
    expect(pushes.filter((p) => p.to[0] === "admin")).toHaveLength(2);
    const off = await svc.setLooking(1, "u1", false);
    expect(off.looking).toBe(false);
  });
});

describe("D2, D4: Manage > Teams", () => {
  it("an admin teams up two players without partners and both hear about it", async () => {
    const view = await svc.teamUp(1, 1, 3);
    expect(view.teams).toEqual([{ teamId: expect.any(Number), players: [expect.objectContaining({ name: "John Rapiel" }), expect.objectContaining({ name: "Jo Park" })] }]);
    expect(pushes.map((p) => p.to[0]).sort()).toEqual(["u1", "u3"]);
  });

  it("won't team someone who has a partner, or a blocked pair", async () => {
    await svc.teamUp(1, 1, 2);
    expect((await refused(svc.teamUp(1, 1, 3))).message).toMatch(/already has a partner/);
    repo.blocks.add(pairKey(3, 4));
    expect((await refused(svc.teamUp(1, 3, 4))).message).toBe("These two players can't be on a team together.");
  });

  it("splitting a team drops its unplayed matches and tells the players and opponents", async () => {
    const { teams } = await svc.teamUp(1, 1, 2);
    repo.teamMatches.set(teams[0].teamId, ["u1", "u2", "u3", "u4"]);
    pushes.length = 0;
    const view = await svc.split(1, teams[0].teamId);
    expect(view.teams).toEqual([]);
    expect(repo.dropped).toEqual([teams[0].teamId]);
    expect(pushes.filter((p) => p.title === "Team split").map((p) => p.to[0]).sort()).toEqual(["u1", "u2"]);
    expect(pushes.find((p) => p.title === "Match cancelled")?.to.sort()).toEqual(["u3", "u4"]);
  });

  it("D4: a partner leaving mid-season leaves the other player Needs a partner, with byes until re-teamed", async () => {
    await svc.teamUp(1, 1, 2);
    repo.published.add(1);
    pushes.length = 0;
    await svc.onDropout(1, 2);
    repo.people = repo.people.filter((p) => p.id !== 2);
    const manage = await svc.manage(1);
    expect(manage.unpaired.find((u) => u.playerId === 1)?.kind).toBe("needs_partner");
    expect((await svc.mine(1, "u1")).needsPartner).toBe(true);
    expect(pushes.find((p) => p.to[0] === "u1")?.body).toBe(
      "Sam Lee left Thursday Doubles. Your played results stay. You'll have byes until your league admin teams you up with someone new.",
    );
    expect(pushes.find((p) => p.to[0] === "admin")?.title).toBe("A player needs a partner");
    // Re-teamed with anyone unpaired: a new team, starting 0-0.
    const after = await svc.teamUp(1, 1, 3);
    expect(after.teams).toHaveLength(1);
    expect(repo.teamRows.filter((t) => !t.dissolvedAt)).toHaveLength(1);
  });

  it("D4: an Open league can let a waitlisted player in only while someone needs a partner", async () => {
    repo.leagues[0].visibility = "open";
    expect((await svc.manage(1)).canLetInWaitlisted).toBe(false);
    await svc.teamUp(1, 1, 2);
    repo.published.add(1);
    await svc.onDropout(1, 2);
    repo.people = repo.people.filter((p) => p.id !== 2);
    expect((await svc.manage(1)).canLetInWaitlisted).toBe(true);
  });

  it("a dropout ends their pending requests: requests to them return the sender to the list", async () => {
    await svc.request(1, "u3", 2);
    await svc.onDropout(1, 2);
    expect(repo.requestRows[0].status).toBe("taken");
    expect(repo.people.find((p) => p.id === 3)!.lookingForPartnerAt).not.toBeNull();
  });
});

describe("routes", () => {
  function app(admin = false) {
    const a = express();
    a.use(express.json());
    a.use(
      createDoublesPartnersRouter({
        service: async () => svc,
        isAdmin: async () => admin,
        openChat: async () => ({ groupId: 77 }),
      }),
    );
    return supertest(a);
  }

  it("members read and act on their own partner state", async () => {
    mockUserId = "u1";
    const res = await app().post("/leagues/1/partner/requests").send({ toPlayerId: 2 });
    expect(res.status).toBe(200);
    expect(res.body.outgoing.to.name).toBe("Sam Lee");
    mockUserId = "u2";
    const sam = await app().get("/leagues/1/partner");
    const accept = await app().post(`/leagues/1/partner/requests/${sam.body.incoming[0].requestId}/accept`);
    expect(accept.body.partner.name).toBe("John Rapiel");
  });

  it("answers refusals in words with their status", async () => {
    mockUserId = "u1";
    const res = await app().post("/leagues/1/partner/requests").send({ toPlayerId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Pick someone else to team up with.");
    expect((await app().post("/leagues/1/partner/looking").send({})).status).toBe(400);
  });

  it("Manage > Teams is for league admins only", async () => {
    mockUserId = "u1";
    expect((await app(false).get("/leagues/1/teams")).status).toBe(403);
    expect((await app(false).post("/leagues/1/teams").send({ playerIds: [1, 2] })).status).toBe(403);
    const ok = await app(true).post("/leagues/1/teams").send({ playerIds: [1, 2] });
    expect(ok.status).toBe(200);
    expect(ok.body.teams).toHaveLength(1);
    const split = await app(true).post(`/leagues/1/teams/${ok.body.teams[0].teamId}/split`);
    expect(split.body.teams).toEqual([]);
  });

  it("needs a signed-in person", async () => {
    mockUserId = null;
    expect((await app().get("/leagues/1/partner")).status).toBe(401);
    mockUserId = "u1";
  });

  it("D6: Message on a doubles match returns the group chat", async () => {
    mockUserId = "u1";
    const res = await app().post("/leagues/1/matches/9/chat");
    expect(res.body).toEqual({ groupId: 77 });
  });
});
