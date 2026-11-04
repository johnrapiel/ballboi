import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyLeagueWeek, type LeagueWeekItem, type LeagueWeekPlayoff, type LeagueWeekResult } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { ListRow } from "@/components/league/ListRow";
import { MatchCard, type MatchCardAction } from "@/components/MatchCard";
import { DoublesRecordButton } from "@/components/record/DoublesMatchCard";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { dateRange, deadlineDate, isToday, matchWhen, pairingTime, shortDate } from "@/lib/leagueSchedule";
import { openRecorder } from "@/lib/recording/start";

// Home (spec: Navigation > Home: upcoming matches, this week's pairings,
// recent results). Pending match requests join this tab with Discover.
//
// PR 4: a singles league match you can play now has "Record with Ball Boi"
// next to Enter score, any day that week. A match with a set time today comes
// first, under Today. Doubles shows Record dimmed with the reason.

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

function ResultRow({ r, last, onPress }: { r: LeagueWeekResult; last: boolean; onPress: () => void }) {
  const outcome = r.won ? "Won" : "Lost";
  const sub = [`vs. ${r.opponentName}`, r.leagueName, r.playoff ? "Playoffs" : null, r.inGrace ? "Grace week, not in standings" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <ListRow
      title={`${outcome} ${r.score}`}
      subtitle={sub}
      symbol={r.won ? "checkmark.circle" : "xmark.circle"}
      onPress={onPress}
      accessibilityHint="Opens the league"
      last={last}
    />
  );
}

export default function HomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const weekQ = useGetMyLeagueWeek();
  const week = weekQ.data;

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

  const playoffCard = (p: LeagueWeekPlayoff) => (
    <MatchCard
      key={`po-${p.matchId}`}
      eyebrow={`${p.leagueName} · Playoffs · ${ROUND_SINGULAR[p.round as keyof typeof ROUND_SINGULAR] ?? "Playoff"}`}
      title={`You vs. ${p.opponentName}`}
      onOpen={() => openLeague(p.leagueId)}
      primary={p.singles ? record(p.leagueId, p.matchId, p.opponentName) : scoreAction(p.leagueId, p.matchId, p.opponentName)}
      secondary={p.singles ? scoreAction(p.leagueId, p.matchId, p.opponentName) : null}
      footer={p.singles ? null : <DoublesRecordButton matchId={p.matchId} />}
    />
  );

  const nothing =
    !!week && week.thisWeek.length === 0 && week.playoffs.length === 0 && week.drafts.length === 0 && week.recent.length === 0;

  return (
    <TabScreen title="Home" roundel>
      {weekQ.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
        </View>
      ) : nothing ? (
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
          <EmptyState symbol="tennisball" title="No league matches yet" message="Start or join a league, and your matches show up here each week." />
          <View style={{ paddingHorizontal: spacing.space4, paddingBottom: spacing.space8 }}>
            <Button label="Go to Leagues" variant="secondary" onPress={() => router.push("/(tabs)/leagues")} />
          </View>
        </View>
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

          {todays.length > 0 ? (
            <>
              <Text variant="label" tone="inkMuted" accessibilityRole="header" style={{ marginTop: spacing.space2 }}>
                Today
              </Text>
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

          {week && (week.playoffs.length > 0 || rest.length > 0) ? (
            <Text variant="label" tone="inkMuted" accessibilityRole="header" style={{ marginTop: spacing.space2 }}>
              This week
            </Text>
          ) : null}

          {week?.playoffs.map(playoffCard)}

          {rest.map(weekCard)}

          {week && week.recent.length > 0 ? (
            <>
              <Text variant="label" tone="inkMuted" accessibilityRole="header" style={{ marginTop: spacing.space2 }}>
                Recent results
              </Text>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {week.recent.map((r, n) => (
                  <ResultRow key={r.matchId} r={r} last={n === week.recent.length - 1} onPress={() => openLeague(r.leagueId)} />
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </TabScreen>
  );
}
