// Doubles partners: teaming up, the Find me a partner list, admin team up
// and split, and what happens when a partner leaves (D2, D4, D9). The rules
// are in lib/doublesTeams.ts; storage behind DoublesPartnersRepo.

import {
  canLetInForPartner,
  checkRequest,
  checkRespond,
  expiresAt,
  isExpired,
  isFixedDoubles,
  noticeText,
  requestCandidates,
  requestsEndedByTeam,
  unpairedMembers,
  type PartnerRequest,
  type TeamRow,
  type UnpairedKind,
} from "../lib/doublesTeams.js";
import { checkNewTeam } from "../lib/doublesPairing.js";
import { pairKey } from "../lib/pairing.js";
import { DrizzleDoublesPartnersRepo, type DoublesPartnersRepo, type Member } from "../lib/doublesPartnersRepo.js";

export type Push = (userIds: string[], title: string, body: string, link?: string) => Promise<void>;

export class PartnersError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PersonView {
  playerId: number;
  name: string;
  level: number;
  /** users.id for their player card; null for a player not on Ball Boi yet. */
  userId: number | null;
  photoUrl: string | null;
}

/** What a member sees in a fixed-partner league: the team-up step and the request notice (D9). */
export interface MyPartnerView {
  /** A fixed-partner doubles league: teams apply. */
  fixedPartners: boolean;
  /** You play in this league. */
  member: boolean;
  /** Requests and Find me a partner close when the first round goes out. */
  teamingOpen: boolean;
  partner: PersonView | null;
  looking: boolean;
  /** Your request out: Cancel while it's pending. */
  outgoing: { requestId: number; to: PersonView; expiresAt: string } | null;
  /** Requests to you: Accept or Decline. */
  incoming: { requestId: number; from: PersonView; expiresAt: string }[];
  /** Why your request ended without a team, until you dismiss it. */
  notice: { requestId: number; text: string } | null;
  /** Members you can ask: no partner yet, never someone you have a block with. */
  candidates: PersonView[];
  /** Your partner left: byes until an admin teams you up (D4). */
  needsPartner: boolean;
}

/** Manage > Teams (D2, D4, D9). */
export interface TeamsView {
  fixedPartners: boolean;
  firstRoundOut: boolean;
  teams: { teamId: number; players: PersonView[] }[];
  /** Without a partner, highest level first. */
  unpaired: (PersonView & { kind: UnpairedKind })[];
  /** An Open league can let a waitlisted player in for a player who needs a partner (D4). */
  canLetInWaitlisted: boolean;
}

const person = (m: Member): PersonView => ({
  playerId: m.id,
  name: m.name,
  level: m.level,
  userId: m.userId ?? null,
  photoUrl: m.avatarUrl ?? null,
});
const activeTeams = (teams: TeamRow[]) => teams.filter((t) => !t.dissolvedAt);
const teamOf = (teams: TeamRow[], playerId: number) =>
  activeTeams(teams).find((t) => t.player1Id === playerId || t.player2Id === playerId) ?? null;

export class DoublesPartnersService {
  constructor(
    private repo: DoublesPartnersRepo,
    private push: Push,
    private clock: () => Date = () => new Date(),
  ) {}

  private notify(to: (string | null | undefined)[], title: string, body: string, link: string) {
    const ids = to.filter((id): id is string => !!id);
    if (ids.length) this.push(ids, title, body, link).catch(() => {});
  }

  private async load(leagueId: number) {
    const league = await this.repo.league(leagueId);
    if (!league) throw new PartnersError(404, "League not found");
    const [members, teams, requests, firstRoundOut] = await Promise.all([
      this.repo.members(leagueId),
      this.repo.teams(leagueId),
      this.repo.requests(leagueId),
      this.repo.firstRoundOut(leagueId),
    ]);
    return { league, members, teams, requests, firstRoundOut };
  }

  /** Pending requests past 48 hours are settled as expired before anything reads them. */
  private async settleExpired(requests: PartnerRequest[], members: Member[], leagueName: string, leagueId: number) {
    const now = this.clock();
    for (const r of requests.filter((x) => isExpired(x, now))) {
      if (!(await this.repo.settleRequest(r.id, "expired", now))) continue;
      r.status = "expired";
      r.respondedAt = now;
      await this.backToLooking(r, members, leagueName, leagueId);
    }
  }

  /** Declined, expired or taken: the sender goes back on the list, with a notice in words (D9). */
  private async backToLooking(r: PartnerRequest, members: Member[], leagueName: string, leagueId: number) {
    const from = members.find((m) => m.id === r.fromPlayerId);
    const to = members.find((m) => m.id === r.toPlayerId);
    await this.repo.setLooking([r.fromPlayerId], this.clock());
    if (from) from.lookingForPartnerAt = this.clock();
    const text = noticeText(r.status, to?.name ?? "That player");
    if (text && from) this.notify([from.clerkUserId], leagueName, text, `/league/${leagueId}`);
  }

  async mine(leagueId: number, me: string): Promise<MyPartnerView> {
    const { league, members, teams, requests, firstRoundOut } = await this.load(leagueId);
    const fixed = isFixedDoubles(league);
    const self = members.find((m) => m.clerkUserId === me) ?? null;
    const base: MyPartnerView = {
      fixedPartners: fixed,
      member: !!self,
      teamingOpen: fixed && !firstRoundOut && !league.endedAt,
      partner: null,
      looking: false,
      outgoing: null,
      incoming: [],
      notice: null,
      candidates: [],
      needsPartner: false,
    };
    if (!fixed || !self) return base;
    await this.settleExpired(requests, members, league.name, leagueId);

    const byId = new Map(members.map((m) => [m.id, m]));
    const team = teamOf(teams, self.id);
    const partnerId = team ? (team.player1Id === self.id ? team.player2Id : team.player1Id) : null;
    const blocked = await this.repo.blockedPairs(members.map((m) => m.id));
    const teamed = new Set(activeTeams(teams).flatMap((t) => [t.player1Id, t.player2Id]));
    const pending = requests.filter((r) => r.status === "pending");
    const out = pending.find((r) => r.fromPlayerId === self.id);
    // The latest request of yours that ended without a team, until you dismiss it.
    const ended = requests
      .filter((r) => r.fromPlayerId === self.id && !r.noticeSeenAt && noticeText(r.status, "") !== null)
      .sort((a, b) => (b.respondedAt?.getTime() ?? 0) - (a.respondedAt?.getTime() ?? 0))[0];
    const kind = unpairedMembers(members, teams).find((u) => u.member.id === self.id)?.kind ?? null;
    const view = (id: number) => (byId.has(id) ? person(byId.get(id)!) : { playerId: id, name: "Player", level: 3, userId: null, photoUrl: null });

    return {
      ...base,
      partner: partnerId != null ? view(partnerId) : null,
      looking: !team && !!self.lookingForPartnerAt,
      outgoing: out ? { requestId: out.id, to: view(out.toPlayerId), expiresAt: expiresAt(out).toISOString() } : null,
      // Someone you've blocked (or who blocked you) can't have asked; a block made after hides it.
      incoming: pending
        .filter((r) => r.toPlayerId === self.id && !blocked.has(pairKey(r.fromPlayerId, self.id)))
        .map((r) => ({ requestId: r.id, from: view(r.fromPlayerId), expiresAt: expiresAt(r).toISOString() })),
      notice: ended && !team ? { requestId: ended.id, text: noticeText(ended.status, view(ended.toPlayerId).name)! } : null,
      candidates: team || firstRoundOut ? [] : requestCandidates(members, teamed, self.id, blocked).map(person),
      needsPartner: kind === "needs_partner",
    };
  }

  private async memberFor(leagueId: number, me: string, members: Member[]): Promise<Member> {
    const self = members.find((m) => m.clerkUserId === me);
    if (!self) throw new PartnersError(403, "Join this league to team up.");
    return self;
  }

  /** "Team up with someone" (D9). */
  async request(leagueId: number, me: string, toPlayerId: number): Promise<MyPartnerView> {
    const { league, members, teams, requests, firstRoundOut } = await this.load(leagueId);
    await this.settleExpired(requests, members, league.name, leagueId);
    const self = members.find((m) => m.clerkUserId === me) ?? null;
    const blocked = await this.repo.blockedPairs(members.map((m) => m.id));
    const check = checkRequest({
      league,
      firstRoundOut,
      fromPlayerId: self?.id ?? null,
      toPlayerId,
      activePlayerIds: members.map((m) => m.id),
      teamed: new Set(activeTeams(teams).flatMap((t) => [t.player1Id, t.player2Id])),
      pending: requests.filter((r) => r.status === "pending"),
      blocked,
    });
    if (!check.ok) throw new PartnersError(check.status, check.error);
    await this.repo.createRequest(leagueId, self!.id, toPlayerId, this.clock());
    const to = members.find((m) => m.id === toPlayerId)!;
    this.notify(
      [to.clerkUserId],
      "Team up?",
      `${self!.name} wants to team up for ${league.name}. Accept or decline in the league. You have 48 hours.`,
      `/league/${leagueId}`,
    );
    return this.mine(leagueId, me);
  }

  /** Accept or Decline a request to you (D9). */
  async respond(leagueId: number, me: string, requestId: number, accept: boolean): Promise<MyPartnerView> {
    const { league, members, teams, requests } = await this.load(leagueId);
    await this.settleExpired(requests, members, league.name, leagueId);
    const self = await this.memberFor(leagueId, me, members);
    const r = requests.find((x) => x.id === requestId) ?? null;
    const check = checkRespond(r, [self.id], this.clock());
    if (!check.ok) throw new PartnersError(check.status, check.error);
    const from = members.find((m) => m.id === r!.fromPlayerId);
    const now = this.clock();

    if (!accept) {
      if (await this.repo.settleRequest(r!.id, "declined", now)) {
        r!.status = "declined";
        await this.backToLooking(r!, members, league.name, leagueId);
      }
      return this.mine(leagueId, me);
    }

    const blocked = await this.repo.blockedPairs([r!.fromPlayerId, self.id]);
    const problem = checkNewTeam({
      teams: activeTeams(teams).map((t) => ({ id: t.id, playerIds: [t.player1Id, t.player2Id] })),
      activePlayerIds: members.map((m) => m.id),
      a: r!.fromPlayerId,
      b: self.id,
      blocked,
    });
    if (problem) {
      // They got a partner in the meantime (or left): this one can't go ahead.
      await this.repo.settleRequest(r!.id, "cancelled", now);
      throw new PartnersError(409, from ? `${from.name} isn't available to team up any more.` : problem);
    }
    if (!(await this.repo.settleRequest(r!.id, "accepted", now))) throw new PartnersError(409, "This request was already answered.");
    await this.formTeam(leagueId, league.name, members, requests, r!.fromPlayerId, self.id, "request", r!);
    this.notify([from?.clerkUserId], "You're teamed up", `${self.name} accepted. You're partners for ${league.name}.`, `/league/${leagueId}`);
    return this.mine(leagueId, me);
  }

  /** Makes the team, takes both off the list, and ends any other request touching them. */
  private async formTeam(
    leagueId: number,
    leagueName: string,
    members: Member[],
    requests: PartnerRequest[],
    a: number,
    b: number,
    madeBy: "request" | "admin",
    except?: PartnerRequest,
  ): Promise<TeamRow> {
    const now = this.clock();
    const team = await this.repo.createTeam(leagueId, a, b, madeBy, now);
    await this.repo.setLooking([a, b], null);
    for (const other of requestsEndedByTeam(requests, [a, b], except)) {
      // Theirs to one of the new partners: "teamed up with someone else". Theirs from one: just closed.
      const status = [a, b].includes(other.toPlayerId) ? "taken" : "cancelled";
      if (!(await this.repo.settleRequest(other.id, status, now))) continue;
      other.status = status;
      if (status === "taken") await this.backToLooking(other, members, leagueName, leagueId);
    }
    return team;
  }

  /** Cancel your own pending request. */
  async cancel(leagueId: number, me: string, requestId: number): Promise<MyPartnerView> {
    const { members, requests } = await this.load(leagueId);
    const self = await this.memberFor(leagueId, me, members);
    const r = requests.find((x) => x.id === requestId);
    if (!r || r.fromPlayerId !== self.id) throw new PartnersError(404, "Request not found");
    await this.repo.settleRequest(r.id, "cancelled", this.clock());
    return this.mine(leagueId, me);
  }

  /** Done with the notice about a declined or unanswered request. */
  async dismissNotice(leagueId: number, me: string, requestId: number): Promise<MyPartnerView> {
    const { members, requests } = await this.load(leagueId);
    const self = await this.memberFor(leagueId, me, members);
    const r = requests.find((x) => x.id === requestId);
    if (!r || r.fromPlayerId !== self.id) throw new PartnersError(404, "Request not found");
    await this.repo.noticeSeen(r.id, this.clock());
    return this.mine(leagueId, me);
  }

  /** "Find me a partner" on or off (D9). */
  async setLooking(leagueId: number, me: string, on: boolean): Promise<MyPartnerView> {
    const { league, members, teams, firstRoundOut } = await this.load(leagueId);
    if (!isFixedDoubles(league)) throw new PartnersError(409, "Only fixed-partner doubles leagues have teams.");
    const self = await this.memberFor(leagueId, me, members);
    if (on && teamOf(teams, self.id)) throw new PartnersError(409, "You already have a partner.");
    if (on && firstRoundOut) throw new PartnersError(409, "Teaming up closed when the first round went out. Your league admin can team you up in Manage.");
    await this.repo.setLooking([self.id], on ? this.clock() : null);
    if (on) {
      const admins = (await this.repo.admins(leagueId)).filter((id) => id !== me);
      this.notify(admins, "Looking for a partner", `${self.name} is looking for a partner in ${league.name}. Team them up in Manage.`, `/league/${leagueId}/manage`);
    }
    return this.mine(leagueId, me);
  }

  /** Manage > Teams. */
  async manage(leagueId: number): Promise<TeamsView> {
    const { league, members, teams, requests, firstRoundOut } = await this.load(leagueId);
    await this.settleExpired(requests, members, league.name, leagueId);
    const byId = new Map(members.map((m) => [m.id, m]));
    const unpaired = unpairedMembers(members, teams);
    return {
      fixedPartners: isFixedDoubles(league),
      firstRoundOut,
      teams: activeTeams(teams)
        .map((t) => ({ teamId: t.id, players: [t.player1Id, t.player2Id].map((id) => byId.get(id)).filter((m): m is Member => !!m).map(person) }))
        .filter((t) => t.players.length === 2)
        .sort((a, b) => a.players[0].name.localeCompare(b.players[0].name)),
      unpaired: unpaired.map((u) => ({ ...person(u.member), kind: u.kind })),
      canLetInWaitlisted: canLetInForPartner(league, unpaired.some((u) => u.kind === "needs_partner")),
    };
  }

  /** An admin teams up two players without partners (D2; D4 re-teaming starts 0-0). */
  async teamUp(leagueId: number, a: number, b: number): Promise<TeamsView> {
    const { league, members, teams, requests } = await this.load(leagueId);
    if (!isFixedDoubles(league)) throw new PartnersError(409, "Only fixed-partner doubles leagues have teams.");
    if (league.endedAt) throw new PartnersError(409, "This league has ended.");
    const blocked = await this.repo.blockedPairs([a, b]);
    const problem = checkNewTeam({
      teams: activeTeams(teams).map((t) => ({ id: t.id, playerIds: [t.player1Id, t.player2Id] })),
      activePlayerIds: members.map((m) => m.id),
      a,
      b,
      blocked,
    });
    if (problem) throw new PartnersError(409, problem);
    await this.formTeam(leagueId, league.name, members, requests, a, b, "admin");
    const [pa, pb] = [a, b].map((id) => members.find((m) => m.id === id)!);
    this.notify([pa.clerkUserId], "You're teamed up", `Your league admin teamed you up with ${pb.name} for ${league.name}.`, `/league/${leagueId}`);
    this.notify([pb.clerkUserId], "You're teamed up", `Your league admin teamed you up with ${pa.name} for ${league.name}.`, `/league/${leagueId}`);
    return this.manage(leagueId);
  }

  /** An admin splits a team. Its unplayed matches go: drafts pair again, rounds already out are voided. */
  async split(leagueId: number, teamId: number): Promise<TeamsView> {
    const { league, members, teams } = await this.load(leagueId);
    const team = activeTeams(teams).find((t) => t.id === teamId);
    if (!team) throw new PartnersError(404, "Team not found");
    if (league.endedAt) throw new PartnersError(409, "This league has ended.");
    const now = this.clock();
    if (!(await this.repo.dissolveTeam(team.id, "split", now))) throw new PartnersError(409, "That team was already split.");
    const affected = await this.repo.dropTeamMatches(team.id, now);
    const pair = [team.player1Id, team.player2Id].map((id) => members.find((m) => m.id === id));
    for (const [me, them] of [[pair[0], pair[1]], [pair[1], pair[0]]] as const) {
      this.notify([me?.clerkUserId], "Team split", `Your league admin split your team with ${them?.name ?? "your partner"} in ${league.name}.`, `/league/${leagueId}`);
    }
    const opponents = affected.filter((id) => !pair.some((p) => p?.clerkUserId === id));
    this.notify(opponents, "Match cancelled", `A team in ${league.name} was split, so your match is cancelled.`, `/league/${leagueId}`);
    return this.manage(leagueId);
  }

  /**
   * D4: a player left the league (Leave, Remove). Their team breaks up: the
   * other player "Needs a partner" in Manage and gets byes until an admin
   * re-teams them. Their requests end. Voiding their matches is the dropout
   * itself (decision 27).
   */
  async onDropout(leagueId: number, playerId: number): Promise<void> {
    const league = await this.repo.league(leagueId);
    if (!league || !isFixedDoubles(league)) return;
    const [teams, requests, members] = await Promise.all([this.repo.teams(leagueId), this.repo.requests(leagueId), this.repo.members(leagueId)]);
    const now = this.clock();
    for (const r of requests.filter((x) => x.status === "pending" && (x.fromPlayerId === playerId || x.toPlayerId === playerId))) {
      const status = r.toPlayerId === playerId ? "taken" : "cancelled";
      if (await this.repo.settleRequest(r.id, status, now)) {
        r.status = status;
        if (status === "taken") await this.backToLooking(r, members, league.name, leagueId);
      }
    }
    await this.repo.setLooking([playerId], null);
    const team = teamOf(teams, playerId);
    if (!team || !(await this.repo.dissolveTeam(team.id, "partner_left", now))) return;
    const partner = members.find((m) => m.id === (team.player1Id === playerId ? team.player2Id : team.player1Id));
    const leaver = members.find((m) => m.id === playerId);
    const firstRoundOut = await this.repo.firstRoundOut(leagueId);
    if (partner) {
      this.notify(
        [partner.clerkUserId],
        "Your partner left",
        firstRoundOut
          ? `${leaver?.name ?? "Your partner"} left ${league.name}. Your played results stay. You'll have byes until your league admin teams you up with someone new.`
          : `${leaver?.name ?? "Your partner"} left ${league.name}. Team up with someone else before the first round goes out.`,
        `/league/${leagueId}`,
      );
      if (firstRoundOut) {
        const admins = await this.repo.admins(leagueId);
        this.notify(admins, "A player needs a partner", `${partner.name} needs a partner in ${league.name}. Team them up in Manage.`, `/league/${leagueId}/manage`);
      }
    }
  }

  /** Hourly: requests unanswered for 48 hours expire, and their senders hear in words (D9). */
  async expireRequests(): Promise<number> {
    const now = this.clock();
    const stale = await this.repo.pendingBefore(new Date(now.getTime() - 48 * 3_600_000));
    let n = 0;
    const byLeague = new Map<number, PartnerRequest[]>();
    for (const r of stale) byLeague.set(r.leagueId, [...(byLeague.get(r.leagueId) ?? []), r]);
    for (const [leagueId, list] of byLeague) {
      const league = await this.repo.league(leagueId);
      const members = await this.repo.members(leagueId);
      for (const r of list) {
        if (!(await this.repo.settleRequest(r.id, "expired", now))) continue;
        r.status = "expired";
        n++;
        await this.backToLooking(r, members, league?.name ?? "Your league", leagueId);
      }
    }
    return n;
  }
}

let service: DoublesPartnersService | null = null;

/** The app's partners service, on the database and real push. */
export async function getDoublesPartners(): Promise<DoublesPartnersService> {
  if (!service) {
    const { sendPushToUsers } = await import("../routes/notifications.js");
    service = new DoublesPartnersService(new DrizzleDoublesPartnersRepo(), sendPushToUsers);
  }
  return service;
}
