import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyLeagueWeek, type LeagueWeekItem, type LeagueWeekPlayoff } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { DiscoverMatchesSection } from "@/components/discover/DiscoverMatches";
import { HomeLeagues, SectionHead } from "@/components/HomeLeagues";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { MatchCard, type MatchCardAction } from "@/components/MatchCard";
import { DoublesRecordButton } from "@/components/record/DoublesMatchCard";
import { ResultRow } from "@/components/ResultRow";
import { SeasonStats } from "@/components/SeasonStats";
import { TabScreen } from "@/components/TabHeader";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { dateRange, deadlineDate, isToday, matchWhen, pairingTime, shortDate } from "@/lib/leagueSchedule";
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
// Fix 2 (findings 6, 14, 27; John, Nov 6): your season stats sit above the
// next match, with See all opening My matches. With one league its standings
// follow; with two or more, Your leagues. Recent results open Match detail.
// With nothing to show yet, the roundel sits large in the empty state and the
// header has none; once there's content it's back in the top left. No "Go to
// Leagues" button: Leagues is the next tab. Q5b: a playoff match shows its play-by
// date; after it, the admin enters the result, so Home offers nothing.

function weekDetail(i: LeagueWeekItem): string {
  const when = matchWhen(i.scheduledAt);
  const time = when ? `${when}. ` : "";
  if (i.played) return "Score entered. See the result in the league.";
  if (i.phase === "upcoming") return `Starts ${shortDate(i.startDate)}. Play by ${deadlineDate(i.deadline, i.timeZone)}.`;
  if (i.phase === "grace") return `${time}Grace week until ${deadlineDate(i.graceEnd, i.timeZone)}.`;
  return `${time}Play by ${deadlineDate(i.deadline, i.timeZone)}.`;
}

/** Whether a week's match can be played (and so scored or recorded) now. */
const playable = (i: LeagueWeekItem) => !i.bye && i.matchId != null && i.phase !== "upcoming" && !i.played;

export default function HomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const weekQ = useGetMyLeagueWeek();
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
  const enterScore = (leagueId: number, matchId: number) => router.push(`/league/${leagueId}/score/${matchId}`);
  const record = (leagueId: number, matchId: number, opponentName: string): MatchCardAction => ({
    label: "Record with Ball Boi",
    onPress: () => openRecorder(router, { matchId, opponentName, leagueId }),
    hint: `Records your match against ${opponentName}`,
  });
  const scoreAction = (leagueId: number, matchId: number, opponentName: string): MatchCardAction => ({
    label: "Enter score",
    onPress: () => enterScore(leagueId, matchId),
    hint: `For your match against ${opponentName}`,
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
    return (
      <MatchCard
        key={`m-${i.matchId}`}
        eyebrow={`${i.leagueName} · Round ${i.roundNumber}`}
        title={`You vs. ${opponent}`}
        detail={weekDetail(i)}
        note={i.phase === "grace" && !i.played ? "A score now counts for Ball Boi stats, not standings." : null}
        onOpen={() => openLeague(i.leagueId)}
        primary={canPlay ? (i.singles ? record(i.leagueId, i.matchId!, opponent) : scoreAction(i.leagueId, i.matchId!, opponent)) : null}
        secondary={canPlay && i.singles ? scoreAction(i.leagueId, i.matchId!, opponent) : null}
        footer={canPlay && !i.singles ? <DoublesRecordButton matchId={i.matchId!} /> : null}
      />
    );
  };

  const playoffCard = (p: LeagueWeekPlayoff) => {
    const open = !p.pastPlayBy;
    return (
      <MatchCard
        key={`po-${p.matchId}`}
        eyebrow={`${p.leagueName} · Playoffs · ${ROUND_SINGULAR[p.round as keyof typeof ROUND_SINGULAR] ?? "Playoff"}`}
        title={`You vs. ${p.opponentName}`}
        detail={p.playBy ? (open ? `Play by ${deadlineDate(p.playBy, p.timeZone)}.` : `The play-by date was ${deadlineDate(p.playBy, p.timeZone)}.`) : null}
        note={open ? null : "Your league admin can enter the result."}
        onOpen={() => openLeague(p.leagueId)}
        primary={open ? (p.singles ? record(p.leagueId, p.matchId, p.opponentName) : scoreAction(p.leagueId, p.matchId, p.opponentName)) : null}
        secondary={open && p.singles ? scoreAction(p.leagueId, p.matchId, p.opponentName) : null}
        footer={open && !p.singles ? <DoublesRecordButton matchId={p.matchId} /> : null}
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
          <View style={{ padding: spacing.space4 }}>
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

          {showStats && week ? <SeasonStats season={week.season} /> : null}

          {/* Matches set up in a Discover chat (Wave 2, Session F). */}
          <DiscoverMatchesSection />

          {todays.length > 0 ? (
            <>
              {matchHead("Today", firstHead === "today")}
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

          {week && (week.playoffs.length > 0 || rest.length > 0) ? matchHead("This week", firstHead === "week") : null}

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
