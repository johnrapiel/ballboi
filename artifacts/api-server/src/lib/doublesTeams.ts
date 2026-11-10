// Doubles partners: the rules (doubles flow review, John, Nov 9, D1 to D9).
// Pure, so every rule is testable; services/doublesPartners.ts applies them.
//
// - D1: a doubles league is Fixed partners or Rotating partners.
// - D2: in a fixed-partner league players team up when they join: "Team up
//   with someone" (a request), or "Find me a partner" (a list the admin sees).
//   Admins team up or split in Manage. Anyone without a partner when the
//   first round goes out is teamed with the closest level and keeps them.
// - D4: a partner who leaves mid-season: played results stay, unplayed are
//   voided, the other player "Needs a partner" in Manage, with byes until an
//   admin re-teams them (the new team starts 0-0).
// - D9: a request goes to a member without a partner, with Accept and
//   Decline. Declined, or unanswered after 48 hours, puts the sender back on
//   "Looking for a partner" with a notice in words. Blocked players can't
//   request each other and never see each other on the list.

import { pairKey } from "./pairing.js";

export const REQUEST_HOURS = 48;
const H = 3_600_000;

export type PartnerMode = "fixed" | "rotating";

export interface DoublesLeague {
  leagueType: string;
  partnerMode: string | null;
}

export function isDoubles(league: Pick<DoublesLeague, "leagueType">): boolean {
  return league.leagueType === "doubles";
}

/** Fixed partners, or rotating (also how a doubles league with no setting reads). */
export function partnerModeOf(league: Pick<DoublesLeague, "partnerMode">): PartnerMode {
  return league.partnerMode === "fixed" ? "fixed" : "rotating";
}

export function isFixedDoubles(league: DoublesLeague): boolean {
  return isDoubles(league) && partnerModeOf(league) === "fixed";
}

/** D8: a doubles league needs four players before a round can be paired. */
export const MIN_DOUBLES_PLAYERS = 4;

// ── Names ──────────────────────────────────────────────────────────────────

/** "Sam" from "Sam Lee". */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || "Player";
}

/** "Sam L." from "Sam Lee" (the recap's short form, decision 148). */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "Player";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** A team in standings: "John Rapiel & Sam Lee" (D3). */
export function teamName(names: string[]): string {
  return names.join(" & ");
}

/** "Jo and Lee" */
export function andJoin(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** League page, Home and Profile: "You and Sam vs. Jo and Lee" (D8). First names. */
export function versusLine(partner: string | null, opponents: string[]): string {
  const us = partner ? `You and ${firstName(partner)}` : "You";
  return `${us} vs. ${andJoin(opponents.map(firstName))}`;
}

/** The group chat's title for one member: "You, Sam, Jo and Lee · Week 3" (D6). Partner first. */
export function chatTitleFor(others: string[], roundNumber: number | null): string {
  const names = andJoin(["You", ...others.map(firstName)]);
  return roundNumber ? `${names} · Week ${roundNumber}` : names;
}

// ── Requests (D9) ──────────────────────────────────────────────────────────

export type RequestStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled" | "taken";

export interface PartnerRequest {
  id: number;
  leagueId: number;
  fromPlayerId: number;
  toPlayerId: number;
  status: RequestStatus | string;
  createdAt: Date;
  respondedAt: Date | null;
  noticeSeenAt: Date | null;
}

export function expiresAt(r: Pick<PartnerRequest, "createdAt">): Date {
  return new Date(r.createdAt.getTime() + REQUEST_HOURS * H);
}

/** A pending request nobody answered in 48 hours. */
export function isExpired(r: Pick<PartnerRequest, "status" | "createdAt">, now: Date): boolean {
  return r.status === "pending" && now >= expiresAt(r);
}

/** Why a request ended without a team, in words, for the sender (D9). Null when there's nothing to say. */
export function noticeText(status: string, otherName: string): string | null {
  const back = "You're back on Looking for a partner, so your admin can team you up.";
  if (status === "declined") return `${otherName} can't team up this season. ${back}`;
  if (status === "expired") return `${otherName} didn't answer your request in 48 hours. ${back}`;
  if (status === "taken") return `${otherName} teamed up with someone else. ${back}`;
  return null;
}

export const TEAMING_CLOSED = "Teaming up closed when the first round went out. Your league admin can team you up in Manage.";
export const NOT_AVAILABLE = "This player isn't available to team up.";

export interface RequestCheckInput {
  league: DoublesLeague & { endedAt: Date | null };
  /** Any round has gone out to players. */
  firstRoundOut: boolean;
  fromPlayerId: number | null;
  toPlayerId: number;
  activePlayerIds: number[];
  /** Players on an active team. */
  teamed: Set<number>;
  pending: Pick<PartnerRequest, "fromPlayerId" | "toPlayerId">[];
  blocked: Set<string>;
}

export type Check = { ok: true } | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): Check => ({ ok: false, status, error });

/** "Team up with someone": whether this request can go out. */
export function checkRequest(input: RequestCheckInput): Check {
  const { fromPlayerId: from, toPlayerId: to } = input;
  if (!isFixedDoubles(input.league)) return refuse(409, "Only fixed-partner doubles leagues have teams.");
  if (input.league.endedAt) return refuse(409, "This league has ended.");
  if (from == null || !input.activePlayerIds.includes(from)) return refuse(403, "Join this league to team up.");
  if (input.firstRoundOut) return refuse(409, TEAMING_CLOSED);
  if (from === to) return refuse(400, "Pick someone else to team up with.");
  // A block reads the same as anyone else who can't take a request, so it never says who or why.
  if (!input.activePlayerIds.includes(to) || input.blocked.has(pairKey(from, to))) return refuse(404, NOT_AVAILABLE);
  if (input.teamed.has(from)) return refuse(409, "You already have a partner.");
  if (input.teamed.has(to)) return refuse(409, "They already have a partner.");
  if (input.pending.some((r) => r.fromPlayerId === from)) {
    return refuse(409, "You already have a request out. Cancel it to ask someone else.");
  }
  if (input.pending.some((r) => r.fromPlayerId === to && r.toPlayerId === from)) {
    return refuse(409, "They already asked you. Accept their request instead.");
  }
  return { ok: true };
}

/** Accept or Decline: only the player asked, while it's still pending and inside 48 hours. */
export function checkRespond(r: PartnerRequest | null, myPlayerIds: number[], now: Date): Check {
  if (!r || !myPlayerIds.includes(r.toPlayerId)) return refuse(404, "Request not found");
  if (isExpired(r, now)) return refuse(409, "This request ran out after 48 hours.");
  if (r.status !== "pending") return refuse(409, "This request was already answered.");
  return { ok: true };
}

/** Pending requests that touch either player: they end when one of them gets a partner. */
export function requestsEndedByTeam<T extends Pick<PartnerRequest, "fromPlayerId" | "toPlayerId" | "status">>(
  requests: T[],
  playerIds: number[],
  except?: T,
): T[] {
  return requests.filter(
    (r) => r !== except && r.status === "pending" && (playerIds.includes(r.fromPlayerId) || playerIds.includes(r.toPlayerId)),
  );
}

// ── Who's without a partner (D2, D4, D9) ───────────────────────────────────

export interface MemberRow {
  id: number;
  name: string;
  level: number;
  lookingForPartnerAt: Date | null;
}

export interface TeamRow {
  id: number;
  player1Id: number;
  player2Id: number;
  dissolvedAt: Date | null;
  dissolvedReason: string | null;
}

export type UnpairedKind = "needs_partner" | "looking" | "no_partner";

/**
 * Members without an active team, for Manage > Teams: "Needs a partner"
 * (their partner left, D4), "Looking for a partner" (D9), or neither yet.
 * Each list sorted by level, highest first, then name.
 */
export function unpairedMembers<M extends MemberRow>(members: M[], teams: TeamRow[]): { member: M; kind: UnpairedKind }[] {
  const active = teams.filter((t) => !t.dissolvedAt);
  const teamed = new Set(active.flatMap((t) => [t.player1Id, t.player2Id]));
  const lostPartner = new Set(
    teams
      .filter((t) => t.dissolvedReason === "partner_left")
      .flatMap((t) => [t.player1Id, t.player2Id]),
  );
  const ids = new Set(members.map((m) => m.id));
  return members
    .filter((m) => !teamed.has(m.id))
    .map((member) => ({
      member,
      kind: (lostPartner.has(member.id) && ids.has(member.id)
        ? "needs_partner"
        : member.lookingForPartnerAt
          ? "looking"
          : "no_partner") as UnpairedKind,
    }))
    .sort((a, b) => b.member.level - a.member.level || a.member.name.localeCompare(b.member.name));
}

/** People you can ask in "Team up with someone": members without a partner, never you, never a block (D9). */
export function requestCandidates<M extends MemberRow>(members: M[], teamed: Set<number>, me: number, blocked: Set<string>): M[] {
  return members
    .filter((m) => m.id !== me && !teamed.has(m.id) && !blocked.has(pairKey(m.id, me)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * D4: an Open league's waitlisted player can be let in mid-season when a
 * fixed-partner team lost a partner, so the remaining player can be
 * re-teamed. The season's join lock holds for everyone else.
 */
export function canLetInForPartner(league: DoublesLeague & { visibility: string }, someoneNeedsPartner: boolean): boolean {
  return league.visibility === "open" && isFixedDoubles(league) && someoneNeedsPartner;
}

// ── The doubles match chat's cards (D6) ────────────────────────────────────

export type ChatCard = "day_before" | "did_it_happen";
export const DID_IT_HAPPEN_HOURS = 3;
export const CARD_DAY_BEFORE_HOUR = 8;

/** "6:00 PM" on the league's clock. */
export function clockTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(at);
}

/**
 * The cards due now in a doubles match's chat: the day before (from 8 AM on
 * the league's clock, the day before the match), and "Did it happen?" 3 hours
 * after the start with no score. Only matches with a set time get them.
 */
export function dueChatCards(
  m: { scheduledAt: Date | null; scored: boolean },
  timeZone: string,
  now: Date,
  local: { date: (at: Date, tz: string) => string; hour: (at: Date, tz: string) => number; addDays: (d: string, n: number) => string },
): ChatCard[] {
  if (!m.scheduledAt || Number.isNaN(m.scheduledAt.getTime()) || m.scored) return [];
  const start = m.scheduledAt.getTime();
  const out: ChatCard[] = [];
  const matchDay = local.date(m.scheduledAt, timeZone);
  if (now.getTime() < start && local.date(now, timeZone) === local.addDays(matchDay, -1) && local.hour(now, timeZone) >= CARD_DAY_BEFORE_HOUR) {
    out.push("day_before");
  }
  if (now.getTime() >= start + DID_IT_HAPPEN_HOURS * H) out.push("did_it_happen");
  return out;
}

export function chatCardText(card: ChatCard, scheduledAt: Date, timeZone: string): string {
  return card === "day_before"
    ? `Still on for tomorrow at ${clockTime(scheduledAt, timeZone)}? Say here if anything changes.`
    : "Did it happen? Any of you can enter the score from the match. If you didn't play, say so here.";
}

export const CHAT_SCORED = "The score is in, so this chat is read only.";
export const CHAT_CANCELLED = "This match was cancelled, so this chat is read only.";

/**
 * The result in team names (D7, decision 148): "John R. & Sam L. def. Jo P. &
 * Lee K. 6-3, 6-4", the score from the winners' side.
 */
export function doublesResultLine(winners: string[], losers: string[], scoreFromWinners: string): string {
  const team = (names: string[]) => names.map(shortName).join(" & ");
  return `${team(winners)} def. ${team(losers)} ${scoreFromWinners}`.trim();
}

/** A double default in the match chat (John, Nov 9): "Double default: John R. & Sam L. and Jo P. & Lee K." */
export function doublesDoubleDefaultLine(side1: string[], side2: string[]): string {
  const team = (names: string[]) => names.map(shortName).join(" & ");
  return `Double default: ${team(side1)} and ${team(side2)}`;
}
