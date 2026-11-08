import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyLeagueWeek, type LeagueWeekItem, type LeagueWeekPlayoff } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { DiscoverMatchesSection } from "@/components/discover/DiscoverMatches";
import { HomeLeagues, SectionHead } from "@/components/HomeLeagues";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { MatchCard } from "@/components/MatchCard";
import { NextMatchCard, type NextMatchAction } from "@/components/NextMatchCard";
import { NotificationsOffBanner } from "@/components/NotificationsOffBanner";
import { DoublesNote } from "@/components/record/DoublesMatchCard";
import { ResultRow } from "@/components/ResultRow";
import { SeasonStats } from "@/components/SeasonStats";
import { TabScreen } from "@/components/TabHeader";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { dateRange, deadlineDate, isToday, pairingTime, shortDate } from "@/lib/leagueSchedule";
import { openRecorder } from "@/lib/recording/start";

// Home (spec: Navigation > Home: upcoming matches, this week's pairings,
// recent results; approved canvas: Home, John, Nov 5). The header is the
// roundel alone on the row with Messages, with no date or greeting. Section
// labels are sentence case, match cards are the soft D2 card, and results
// show W or L with no icon. Pending match requests join this tab with Discover.
//
// PR 4: a singles league match you can play now has "Record with Ball Boi"
// next to Enter score, any day that week. A match with a set time today comes
// first, under Today. Doubles shows Record dimmed with the reason.
//
// C4: Home refreshes each time you come back to it, so a score, edit, join,
// leave or end shows straight away.
//
// Design audit (John, Nov 7: the audit overrides anything built that doesn't
// match it): every match on Home is the approved D2 card (NextMatchCard): the
// date, a big serif time, both faces, the court and the league pill. Match day
// singles leads with Record with Ball Boi, then Message and Details; any other
// match has Message and Details. Enter score lives on Details and the league.
// The first section reads "Today's match" on match day, else "Next match".
//
// Fix 2 (findings 6, 14, 27; John, Nov 6): your season stats sit above the
// next match, with See all opening My matches. With one league its standings
// follow; with two or more, Your leagues. Recent results open Match detail.
// With nothing to show yet, the roundel sits large in the empty state and the
// header has none; once there's content it's back in the top left. No "Go to
// Leagues" button: Leagues is the next tab. Q5b: a playoff match shows its play-by
// date; after it, the admin enters the result, so Home offers nothing.

/** The D2 card's date line and big serif line for a match. */
function d2When(scheduledAt: string | null, fallbackDate: string | null, starts?: string | null): { dateLabel: string; time: string } {
  if (scheduledAt) {
    const at = new Date(scheduledAt);
    if (!Number.isNaN(at.getTime())) {
      return {
        dateLabel: isToday(scheduledAt) ? "Today" : at.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
        time: at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      };
    }
  }
  return { dateLabel: starts ? `Starts ${starts}` : "No time set yet", time: fallbackDate ? `By ${fallbackDate}` : "Time to be set" };
}

/** Whether a week's match can be played (and so scored or recorded) now. */
const playable = (i: LeagueWeekItem) => !i.bye && i.matchId != null && i.phase !== "upcoming" && !i.played;

export default function HomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const weekQ = useGetMyLeagueWeek();
  const { profile } = useProfile();
  const myName = profile?.displayName ?? "You";
  const week = weekQ.data;
  const { refetch } = weekQ;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // The first focus is the first load; after that, come back to fresh data.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );

  const openLeague = (leagueId: number) => router.push(`/league/${leagueId}`);
  const record = (leagueId: number, matchId: number, opponentName: string): NextMatchAction => ({
    label: "Record with Ball Boi",
    onPress: () => openRecorder(router, { matchId, opponentName, leagueId }),
    hint: `Records your match against ${opponentName}`,
  });
  const message = (playerId: number | null | undefined, opponentName: string): NextMatchAction | null =>
    playerId
      ? {
          label: "Message",
          accessibilityLabel: `Message ${opponentName}`,
          hint: "Opens a direct chat",
          onPress: () => router.push({ pathname: "/conversation/[id]", params: { id: "new", playerId: String(playerId), name: opponentName } }),
        }
      : null;
  const details = (matchId: number, leagueId: number): NextMatchAction => ({
    label: "Details",
    accessibilityLabel: "Details for this match",
    hint: "Opens the match, where you can enter the score",
    onPress: () => (matchId ? router.push(`/match/${matchId}`) : openLeague(leagueId)),
  });

  // A match with a set time today goes first, earliest first.
  const todays = (week?.thisWeek ?? [])
    .filter((i) => playable(i) && isToday(i.scheduledAt))
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const rest = (week?.thisWeek ?? []).filter((i) => !todays.includes(i));

  const weekCard = (i: LeagueWeekItem) => {
    if (i.bye) {
      return (
        <MatchCard
          key={`bye-${i.roundId}`}
          eyebrow={`${i.leagueName} · Round ${i.roundNumber} · ${dateRange(i.startDate, i.deadline)}`}
          title="You have a bye this week"
          onOpen={() => openLeague(i.leagueId)}
        />
      );
    }
    const opponent = i.opponentName ?? "your opponent";
    const canPlay = playable(i);
    const when = d2When(
      i.scheduledAt,
      deadlineDate(i.phase === "grace" ? i.graceEnd : i.deadline, i.timeZone),
      i.phase === "upcoming" ? shortDate(i.startDate) : null,
    );
    const note = i.played
      ? "Score entered."
      : i.phase === "grace"
        ? "Grace week: a score now counts for Ball Boi stats, not standings."
        : null;
    return (
      <NextMatchCard
        key={`m-${i.matchId}`}
        dateLabel={when.dateLabel}
        time={when.time}
        myName={myName}
        myPhoto={profile?.avatarUrl}
        opponentName={opponent}
        location={i.location}
        league={i.leagueName}
        note={note}
        record={canPlay && i.singles ? record(i.leagueId, i.matchId!, opponent) : null}
        message={message(i.opponentPlayerId, opponent)}
        details={details(i.matchId!, i.leagueId)}
        footer={canPlay && !i.singles ? <DoublesNote matchId={i.matchId!} /> : null}
      />
    );
  };

  const playoffCard = (p: LeagueWeekPlayoff) => {
    const open = !p.pastPlayBy;
    const when = d2When(p.scheduledAt, p.playBy ? deadlineDate(p.playBy, p.timeZone) : null);
    const stage = ROUND_SINGULAR[p.round as keyof typeof ROUND_SINGULAR] ?? "Playoff";
    return (
      <NextMatchCard
        key={`po-${p.matchId}`}
        dateLabel={when.dateLabel}
        time={when.time}
        myName={myName}
        myPhoto={profile?.avatarUrl}
        opponentName={p.opponentName}
        location={p.location}
        league={`${p.leagueName} · ${stage}`}
        note={open ? null : "The play-by date has passed. Your league admin can enter the result."}
        record={open && p.singles ? record(p.leagueId, p.matchId, p.opponentName) : null}
        message={message(p.opponentPlayerId, p.opponentName)}
        details={details(p.matchId, p.leagueId)}
        footer={open && !p.singles ? <DoublesNote matchId={p.matchId} /> : null}
      />
    );
  };

  const nothing =
    !!week &&
    week.thisWeek.length === 0 &&
    week.playoffs.length === 0 &&
    week.drafts.length === 0 &&
    week.recent.length === 0 &&
    week.leagues.length === 0;
  const showStats = !!week && (week.leagues.length > 0 || week.results.length > 0);
  const seeAll = (tab: "upcoming" | "results") => router.push({ pathname: "/matches", params: { tab } });
  // The first match section carries See all, so it sits by the next match.
  const firstHead = todays.length > 0 ? "today" : week && (week.playoffs.length > 0 || rest.length > 0) ? "week" : null;
  const matchHead = (title: string, seeAllHere: boolean) => (
    <SectionHead title={title} onSeeAll={seeAllHere ? () => seeAll("upcoming") : undefined} seeAllLabel="See all matches" />
  );

  return (
    <TabScreen title="Home" roundel={!nothing} bare={nothing}>
      {weekQ.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
        </View>
      ) : nothing ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom }}
          refreshControl={<RefreshControl refreshing={weekQ.isRefetching} onRefresh={() => void weekQ.refetch()} tintColor={c.ink} />}
        >
          <View style={{ padding: spacing.space4, gap: spacing.space3 }}>
            {/* Notifications off: one line to iOS Settings (decision 125). */}
            <NotificationsOffBanner />
            <DiscoverMatchesSection />
          </View>
          <EmptyState roundel title="No league matches yet" message="Start or join a league in Leagues, and your matches show up here each week." />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space3 }}
          refreshControl={<RefreshControl refreshing={weekQ.isRefetching} onRefresh={() => void weekQ.refetch()} tintColor={c.ink} />}
        >
          {weekQ.isError ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="bodyStrong">Couldn't load your matches</Text>
              <Text variant="small" tone="inkMuted">
                Pull down to try again.
              </Text>
            </Card>
          ) : null}

          {/* Notifications off: one line to iOS Settings (decision 125). */}
          <NotificationsOffBanner />

          {showStats && week ? <SeasonStats season={week.season} /> : null}

          {/* Matches set up in a Discover chat (Wave 2, Session F). */}
          <DiscoverMatchesSection />

          {todays.length > 0 ? (
            <>
              {matchHead("Today's match", firstHead === "today")}
              {todays.map(weekCard)}
            </>
          ) : null}

          {week?.drafts.map((d) => (
            <MatchCard
              key={`draft-${d.roundId}`}
              eyebrow={`${d.leagueName} · Admin`}
              title={`Round ${d.roundNumber} pairings are ready to review`}
              detail={`They go out to players ${shortDate(d.startDate)} at ${pairingTime(d.timeZone)}.`}
              primary={{ label: "Review pairings", onPress: () => router.push(`/league/${d.leagueId}/round/${d.roundId}`) }}
            />
          ))}

          {week && (week.playoffs.length > 0 || rest.length > 0) ? matchHead(firstHead === "week" ? "Next match" : "This week", firstHead === "week") : null}

          {week?.playoffs.map(playoffCard)}

          {rest.map(weekCard)}

          {week ? <HomeLeagues leagues={week.leagues} onOpen={openLeague} /> : null}

          {week && week.recent.length > 0 ? (
            <>
              <SectionHead title="Recent results" onSeeAll={() => seeAll("results")} seeAllLabel="See all results" />
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {week.recent.map((r, n) => (
                  <ResultRow key={r.matchId} r={r} last={n === week.recent.length - 1} onPress={() => router.push(`/match/${r.matchId}`)} />
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </TabScreen>
  );
}
