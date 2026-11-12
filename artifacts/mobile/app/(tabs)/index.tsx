import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOpenDoublesMatchChat } from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { MatchCard } from "@/components/MatchCard";
import { NextMatchCard, type NextMatchAction } from "@/components/NextMatchCard";
import { NotificationsOffBanner } from "@/components/NotificationsOffBanner";
import { DoublesNote } from "@/components/record/DoublesMatchCard";
import { SectionHead } from "@/components/SectionHead";
import { TabScreen } from "@/components/TabHeader";
import { Card, Text } from "@/components/ui";
import { UpcomingRows } from "@/components/UpcomingRows";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { upcomingHint, useOpenUpcoming, useUpcomingMatches } from "@/hooks/useUpcomingMatches";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { dateRange, LATE_NOTE, pairingTime, shortDate } from "@/lib/leagueSchedule";
import { openRecorder } from "@/lib/recording/start";
import { cardWhen, isMatchDay, type UpcomingItem } from "@/lib/upcoming";

// Home answers one question: what's next for me (spec decision 137, John,
// Nov 8; canvas W2_HomeUpcoming). The header is the roundel with the glass
// Messages button. Then the Notifications off line (decision 125), anything
// waiting on you (pairings to review, a bye), and every match still to play,
// league, playoff and Discover, in date order under "Upcoming matches".
//
// The first match is the D2 card (NextMatchCard). On match day (a set time
// today) singles leads with Record with Ball Boi, then Message and Details;
// any other day it's Message and Details. Doubles shows Record dimmed with
// the reason. Later matches are plain rows that open Match detail.
//
// Season stats, standings and results don't live here any more: standings
// are on the league page and results on Profile. See all opens Profile's
// Upcoming matches tab.
// Home refreshes on pull and each time you come back to it (C4).

export default function HomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, week, isLoading, isError, refetch } = useUpcomingMatches();
  const pull = usePullToRefresh(refetch);
  const openUpcoming = useOpenUpcoming();
  const { profile } = useProfile();
  const myName = profile?.displayName ?? "You";

  const openLeague = (leagueId: number) => router.push(`/league/${leagueId}`);
  // See all opens your matches on Profile, scrolled to Upcoming matches (decision 138).
  const seeAll = () => router.navigate({ pathname: "/(tabs)/profile", params: { tab: "upcoming", at: String(Date.now()) } });

  const openChat = useOpenDoublesMatchChat();
  const openGroup = (leagueId: number, matchId: number) =>
    openChat
      .mutateAsync({ leagueId, matchId })
      .then(({ groupId }) => router.push({ pathname: "/conversation/group/[id]", params: { id: String(groupId) } }))
      .catch((e) => Alert.alert("Couldn't open the chat", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment."));

  const firstCard = (m: UpcomingItem) => {
    const opponent = m.opponentName ?? "your opponent";
    const when = cardWhen(m);
    // Record leads only on match day, for a singles match that can be played.
    const canRecord = isMatchDay(m) && m.matchId != null && !m.notStarted;
    const record: NextMatchAction | null =
      canRecord && m.singles
        ? {
            label: "Record with Ball Boi",
            onPress: () => openRecorder(router, { matchId: m.matchId!, opponentName: opponent, leagueId: m.leagueId }),
            hint: `Records your match against ${opponent}`,
          }
        : null;
    const chatWith =
      m.kind === "discover"
        ? m.otherUserId
          ? { id: "new", userId: String(m.otherUserId), name: opponent }
          : null
        : m.opponentPlayerId
          ? { id: "new", playerId: String(m.opponentPlayerId), name: opponent }
          : null;
    // D6: a doubles league match's Message opens one chat for all four.
    const doublesChat = m.kind === "league" && !!m.partnerName && m.leagueId != null && m.matchId != null;
    const message: NextMatchAction | null = doublesChat
      ? {
          label: "Message",
          accessibilityLabel: "Message all four players",
          hint: "Opens one group chat for the four of you",
          onPress: () => void openGroup(m.leagueId!, m.matchId!),
        }
      : chatWith
        ? {
            label: "Message",
            accessibilityLabel: `Message ${opponent}`,
            hint: "Opens a direct chat",
            onPress: () => router.push({ pathname: "/conversation/[id]", params: chatWith }),
          }
        : null;
    // An upcoming Discover match's card lives in the chat (decision 151: Match
    // detail is for its result, from Profile's Results).
    const details: NextMatchAction | null =
      m.kind === "discover"
        ? null
        : {
            label: "Details",
            accessibilityLabel: "Details for this match",
            hint: "Opens the match, where you can enter the score",
            onPress: () => (m.matchId ? router.push(`/match/${m.matchId}`) : m.leagueId ? openLeague(m.leagueId) : undefined),
          };
    const note = m.grace ? LATE_NOTE : null;
    return (
      <NextMatchCard
        key={m.key}
        dateLabel={when.dateLabel}
        time={when.time}
        myName={myName}
        myPhoto={profile?.avatarUrl}
        opponentPhoto={m.opponentPhoto}
        opponentName={opponent}
        partnerName={m.partnerName}
        opponentNames={m.opponentNames}
        location={m.location}
        league={m.context}
        note={note}
        record={record}
        message={message}
        details={details}
        footer={canRecord && !m.singles && m.kind !== "discover" ? <DoublesNote matchId={m.matchId!} /> : null}
      />
    );
  };

  // Anything waiting on you: an admin's pairings to review, and a bye.
  const drafts = week?.drafts ?? [];
  const byes = (week?.thisWeek ?? []).filter((i) => i.bye);
  const waiting = drafts.length + byes.length;
  // An open match has no one face to show, so it's always a row.
  const first = items[0] && items[0].kind !== "open" ? items[0] : null;
  const rest = first ? items.slice(1) : items;
  const nothing = !isLoading && !!week && items.length === 0 && waiting === 0;

  return (
    <TabScreen title="Home" roundel={!nothing} bare={nothing}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
        </View>
      ) : nothing ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom }}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
        >
          <View style={{ padding: spacing.space4, gap: spacing.space3 }}>
            {/* Notifications off: one line to iOS Settings (decision 125). */}
            <NotificationsOffBanner />
          </View>
          <EmptyState
            roundel
            title="No upcoming matches"
            message={
              week && week.leagues.length > 0
                ? "Your next league match shows up here once its pairings go out. You can also find a match in Discover."
                : "Join a league in Leagues or find a match in Discover, and your next match shows up here."
            }
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space3 }}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
        >
          {isError ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="bodyStrong">Couldn't load your matches</Text>
              <Text variant="small" tone="inkMuted">
                Pull down to try again.
              </Text>
            </Card>
          ) : null}

          {/* Notifications off: one line to iOS Settings (decision 125). */}
          <NotificationsOffBanner />

          {drafts.map((d) => (
            <MatchCard
              key={`draft-${d.roundId}`}
              eyebrow={`${d.leagueName} · Admin`}
              title={`Round ${d.roundNumber} pairings are ready to review`}
              detail={`They go out to players ${shortDate(d.startDate)} at ${pairingTime(d.timeZone)}.`}
              primary={{ label: "Review pairings", onPress: () => router.push(`/league/${d.leagueId}/round/${d.roundId}`) }}
            />
          ))}

          {byes.map((i) => (
            <MatchCard
              key={`bye-${i.roundId}`}
              eyebrow={`${i.leagueName} · Round ${i.roundNumber} · ${dateRange(i.startDate, i.deadline)}`}
              title="You have a bye this week"
              onOpen={() => openLeague(i.leagueId)}
            />
          ))}

          {items.length > 0 ? (
            <>
              <SectionHead title="Upcoming matches" onSeeAll={seeAll} seeAllLabel="See all upcoming matches" />
              {first ? firstCard(first) : null}
              <UpcomingRows items={rest} onOpen={openUpcoming} hint={upcomingHint} />
            </>
          ) : null}
        </ScrollView>
      )}
    </TabScreen>
  );
}
