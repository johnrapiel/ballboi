import { router } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";

import type { BracketRound, BracketSlot, League, LeagueBracket, LeagueSchedule, MyPartner, ScheduleMatch } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { BracketView, myPlayoffMatch, ROUND_SINGULAR, slotMark } from "@/components/league/Bracket";
import { TeamUpRequestCards } from "@/components/league/PartnerCard";
import { RoundCard } from "@/components/league/RoundCard";
import { YourMatchCard } from "@/components/league/YourMatchCard";
import { WinnerNames } from "@/components/WinnerNames";
import { Button, Card, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { partnerLine } from "@/lib/doubles";
import {
  byeLine,
  currentRound,
  earlierHeading,
  lastPlayoffMatch,
  lastRegularMatch,
  matchSections,
  nextRoundStart,
  notStartedText,
} from "@/lib/leaguePage";
import { dateRange, deadlineDate, myWeek } from "@/lib/leagueSchedule";
import { playersLabel } from "@/lib/leagues";
import { MATCH_CARD_HINT } from "@/lib/matchActions";
import { textTapSlop } from "@/lib/tapTarget";

// The league page's Matches tab (Wave 3, decision 210; John's L1 to L4, Nov
// 14). Top to bottom:
// - The top spot, first that applies: fixed-partner doubles with no partner
//   ("No partner yet · Team up", or a waiting "Team-up request from [name]"
//   with Accept and Decline, L1); your playoff match labeled by round, or
//   your last match once you're knocked out (L2); "Bye this round" (L4); your
//   match card (decision 199), or this round's result once it's in.
// - Before the start: the standard empty state, with Invite players for
//   admins only (L3).
// - Other matches this round (the bracket during playoffs, L2), then Earlier
//   rounds ("Regular season" during playoffs).

function SectionHeading({ children }: { children: string }) {
  return (
    <Text variant="section" tone="inkMuted" accessibilityRole="header">
      {children}
    </Text>
  );
}

/** A small card for the top spot that isn't a match: an icon, a line, and a second line. */
function NoteCard({ icon, title, body, spoken }: { icon: "person.2" | "calendar" | "flag.checkered"; title: string; body?: string | null; spoken?: string }) {
  const c = useColors();
  return (
    <Card accessible accessibilityLabel={spoken ?? [title, body].filter(Boolean).join(". ")} style={{ flexDirection: "row", gap: spacing.space3, alignItems: "flex-start" }}>
      <Icon name={icon} size={20} tintColor={c.ink} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        {body ? (
          <Text variant="small" tone="inkMuted">
            {body}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * L1: fixed-partner doubles, no partner yet. "No partner yet · Team up", where
 * Team up opens the Team up sheet. The lead says where things stand when it's
 * more than nothing ("Waiting on Sam Lee", "Your partner left").
 */
function NoPartnerCard({ leagueId, lead, offline }: { leagueId: number; lead: string; offline: boolean }) {
  const c = useColors();
  const open = () => router.push({ pathname: "/league/[leagueId]/partner", params: { leagueId: String(leagueId) } });
  return (
    <Card style={{ flexDirection: "row", gap: spacing.space3, alignItems: "center" }}>
      <Icon name="person.2" size={20} tintColor={c.ink} />
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.space2 }}>
        <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{`${lead} ·`}</Text>
        <Pressable
          onPress={open}
          disabled={offline}
          accessibilityRole="link"
          accessibilityLabel="Team up"
          accessibilityHint={offline ? "You're offline" : "Opens your options for finding a partner"}
          accessibilityState={{ disabled: offline }}
          // A text link adds no space in the card; its 44pt target is hitSlop (decision 192).
          hitSlop={textTapSlop("bodyStrong")}
          style={({ pressed }) => ({ opacity: offline ? 0.5 : pressed ? 0.6 : 1 })}
        >
          {/* Plain underlined text, not a nested TextLink: a TextLink's own press would still fire while offline. */}
          <Text variant="bodyStrong" style={{ textDecorationLine: "underline" }}>
            Team up
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

/** L2: your playoff match still to play, labeled by round ("Semifinal", "Final"). */
function PlayoffMatchCard({
  leagueId,
  playoff,
  timeZone,
}: {
  leagueId: number;
  playoff: NonNullable<ReturnType<typeof myPlayoffMatch>>;
  timeZone: string | null | undefined;
}) {
  const round = ROUND_SINGULAR[playoff.slot.round];
  const opponent = playoff.opponent?.playerName ?? "to be decided";
  const when = playoff.playBy
    ? playoff.pastPlayBy
      ? `The play-by date was ${deadlineDate(playoff.playBy, timeZone)}. Your league admin can enter the result.`
      : `Play by ${deadlineDate(playoff.playBy, timeZone)}.`
    : null;
  return (
    <Card style={{ gap: spacing.space3 }}>
      <View accessible accessibilityLabel={[`Your ${round.toLowerCase()}. You versus ${opponent}`, when].filter(Boolean).join(". ")} style={{ gap: spacing.space1 }}>
        <Text variant="section" tone="inkMuted">
          {round}
        </Text>
        <Text variant="title">{`You vs. ${playoff.opponent?.playerName ?? "to be decided"}`}</Text>
        {when ? (
          <Text variant="small" tone="inkMuted">
            {when}
          </Text>
        ) : null}
      </View>
      {!playoff.pastPlayBy && playoff.opponent ? (
        <Button
          label="Enter score"
          accessibilityHint={`For your ${round.toLowerCase()}`}
          onPress={() => router.push(`/league/${leagueId}/score/${playoff.slot.matchId}`)}
        />
      ) : null}
    </Card>
  );
}

/** L2: your last playoff match once it's played (knocked out, or the final is done). Tapping opens Match detail. */
function PlayoffResultCard({ slot, round, ended }: { slot: BracketSlot; round: BracketRound; ended: boolean }) {
  const c = useColors();
  const mark = slotMark(slot, round, ended);
  const label = ROUND_SINGULAR[slot.round];
  const p1 = slot.player1?.playerName ?? "To be decided";
  const p2 = slot.player2?.playerName ?? "To be decided";
  const open = slot.matchId != null ? () => router.push(`/match/${slot.matchId}`) : undefined;
  return (
    <Pressable
      onPress={open}
      disabled={!open}
      accessibilityRole={open ? "button" : undefined}
      accessibilityLabel={`Your ${label.toLowerCase()}. ${p1} versus ${p2}. ${mark.spoken}.`}
      accessibilityHint={open ? MATCH_CARD_HINT : undefined}
      style={({ pressed }) => ({
        backgroundColor: c.linen,
        borderColor: c.hairline,
        borderWidth: 1,
        borderRadius: radius.radiusCard,
        padding: spacing.space4,
        gap: spacing.space1,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text variant="section" tone="inkMuted">
        {label}
      </Text>
      <WinnerNames player1Name={p1} player2Name={p2} mark={mark} />
    </Pressable>
  );
}

export function LeagueMatchesTab({
  league,
  leagueId,
  schedule,
  bracket,
  partner,
  myPlayerId,
  isAdmin,
  started,
  ended,
  offline,
  onSettle,
}: {
  league: League;
  leagueId: number;
  schedule: LeagueSchedule | undefined;
  bracket: LeagueBracket | null;
  partner: MyPartner | undefined;
  myPlayerId: number | null;
  isAdmin: boolean;
  started: boolean;
  ended: boolean;
  /** The last refresh failed offline: online-only actions are off (L8). */
  offline: boolean;
  onSettle: (slot: BracketSlot) => void;
}) {
  const doubles = league.leagueType === "doubles";
  const timeZone = schedule?.timeZone ?? league.timeZone;
  const week = myWeek(schedule, myPlayerId);
  const current = currentRound(schedule, week);
  const sections = matchSections(schedule, current, myPlayerId);
  const anyRoundOut = (schedule?.rounds ?? []).some((r) => r.phase !== "draft");
  // Playoffs are on once the bracket exists (L2). Doubles playoffs follow the same layout when they come.
  const playoffs = !!bracket && bracket.rounds.length > 0;
  const openPlayoff = playoffs ? myPlayoffMatch(bracket, myPlayerId) : null;
  const donePlayoff = playoffs && !openPlayoff ? lastPlayoffMatch(bracket, myPlayerId) : null;

  // L1: fixed partners, a member, no partner yet. A waiting request comes first.
  const line = partner && !ended ? partnerLine(partner) : null;
  const noPartner = line?.kind === "none";
  const requestsWaiting = noPartner && (partner?.incoming.length ?? 0) > 0;
  const enterScore = (m: ScheduleMatch) => router.push(`/league/${leagueId}/score/${m.matchId}`);
  const canSetTime = league.matchDay == null || !!schedule?.isAdmin;

  const yourMatch = (w: NonNullable<typeof week>) => (
    <YourMatchCard
      leagueId={leagueId}
      week={w}
      myPlayerId={myPlayerId!}
      timeZone={timeZone}
      canSetTime={canSetTime}
      ended={ended}
      doubles={doubles}
    />
  );

  let top: React.ReactNode = null;
  if (requestsWaiting) {
    top = <TeamUpRequestCards leagueId={leagueId} title={(name) => `Team-up request from ${name}`} disabled={offline} />;
  } else if (noPartner && line?.kind === "none") {
    top = <NoPartnerCard leagueId={leagueId} lead={line.lead} offline={offline} />;
  } else if (playoffs) {
    if (openPlayoff) top = <PlayoffMatchCard leagueId={leagueId} playoff={openPlayoff} timeZone={timeZone} />;
    else if (donePlayoff) top = <PlayoffResultCard slot={donePlayoff.slot} round={donePlayoff.round} ended={ended} />;
    else {
      // Not in the bracket: your last regular-season match.
      const last = lastRegularMatch(schedule, myPlayerId);
      if (last && myPlayerId != null) top = yourMatch(last);
    }
  } else if (week?.bye) {
    // L4: a small card, no buttons.
    const next = byeLine(nextRoundStart(schedule, week.round));
    top = (
      <NoteCard
        icon="calendar"
        title="Bye this round"
        body={next}
        spoken={[`Round ${week.round.roundNumber}, ${dateRange(week.round.startDate, week.round.deadline)}. Bye this round`, next].filter(Boolean).join(". ")}
      />
    );
  } else if (week?.match && myPlayerId != null) {
    top = yourMatch(week);
  } else if (ended && myPlayerId != null) {
    const last = lastRegularMatch(schedule, myPlayerId);
    if (last) top = yourMatch(last);
  }

  // L3: before the start, the standard empty state. Admins get Invite players; players get no button.
  const beforeStart = !started && !anyRoundOut;
  const empty = beforeStart ? notStartedText(league.startDate) : null;
  // During playoffs every league round is the regular season, newest first (L2).
  const earlier = playoffs ? matchSections(schedule, null, myPlayerId).earlier : sections.earlier;

  return (
    <View style={{ gap: spacing.space6 }}>
      {ended ? (
        // Decision 31: an admin ended the league, or the season finished. Standings are final.
        <NoteCard
          icon="flag.checkered"
          title="This league has ended"
          body={
            league.endedAt
              ? `Standings are final as of ${new Date(league.endedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Everything played stays.`
              : "Standings are final. Everything played stays."
          }
        />
      ) : null}

      {top}

      {empty ? (
        <EmptyState roundel title={empty.title} message={empty.message}>
          {isAdmin ? (
            <Button
              label="Invite players"
              accessibilityHint="Shows the invite code and link for this league"
              onPress={() => router.push({ pathname: "/league/invite/[leagueId]", params: { leagueId: String(leagueId), from: "league" } })}
            />
          ) : null}
        </EmptyState>
      ) : null}

      {/* D8: doubles pairs no one until 4 players are in, and says so instead of an empty round. */}
      {doubles && started && !ended && league.playerCount < 4 ? (
        <NoteCard
          icon="person.2"
          title="Doubles needs at least 4 players"
          body={`${playersLabel(league.playerCount)} so far. Pairings start once 4 have joined.${isAdmin ? " Share the invite code in Manage league." : ""}`}
        />
      ) : null}

      {playoffs && bracket ? (
        // L2: the bracket replaces Other matches this round.
        <View style={{ gap: spacing.space3 }}>
          <SectionHeading>Playoffs</SectionHeading>
          <BracketView
            bracket={bracket}
            myPlayerId={myPlayerId}
            onEnterScore={(id) => router.push(`/league/${leagueId}/score/${id}`)}
            onSettle={onSettle}
            isAdmin={isAdmin}
            ended={ended}
            timeZone={timeZone}
          />
        </View>
      ) : (
        <>
          {sections.others ? (
            <View style={{ gap: spacing.space3 }}>
              <SectionHeading>Other matches this round</SectionHeading>
              <RoundCard leagueId={leagueId} round={sections.others} myPlayerId={myPlayerId} onEnterScore={enterScore} ended={ended} timeZone={timeZone} />
            </View>
          ) : null}
          {sections.next.length ? (
            <View style={{ gap: spacing.space3 }}>
              <SectionHeading>Next round</SectionHeading>
              {sections.next.map((r) => (
                <RoundCard key={r.roundId} leagueId={leagueId} round={r} myPlayerId={myPlayerId} onEnterScore={enterScore} ended={ended} timeZone={timeZone} />
              ))}
            </View>
          ) : null}
        </>
      )}

      {earlier.length ? (
        <View style={{ gap: spacing.space3 }}>
          <SectionHeading>{earlierHeading(playoffs)}</SectionHeading>
          {earlier.map((r) => (
            <RoundCard key={r.roundId} leagueId={leagueId} round={r} myPlayerId={myPlayerId} onEnterScore={enterScore} ended={ended} timeZone={timeZone} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
