import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { MatchCard } from "@/components/MatchCard";
import { NextMatchCard, type NextMatchAction } from "@/components/NextMatchCard";
import { NotificationsOffBanner } from "@/components/NotificationsOffBanner";
import { ProblemCard } from "@/components/discover/States";
import { OfflineNotice } from "@/components/OfflineNotice";
import { DoublesNote } from "@/components/record/DoublesMatchCard";
import { SectionHead } from "@/components/SectionHead";
import { TabScreen } from "@/components/TabHeader";
import { UpcomingRows } from "@/components/UpcomingRows";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { useUpcomingMessage } from "@/hooks/useUpcomingMessage";
import { upcomingHint, useOpenUpcoming, useUpcomingMatches } from "@/hooks/useUpcomingMatches";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { dateRange, LATE_NOTE, pairingTime, shortDate } from "@/lib/leagueSchedule";
import { heroIndex } from "@/lib/matchTiming";
import { openRecorder } from "@/lib/recording/start";
import { cardWhen, type UpcomingItem } from "@/lib/upcoming";
import { upcomingActions } from "@/lib/upcomingDetail";

// Home answers one question: what's next for me (spec decision 137, John,
// Nov 8; canvas W2_HomeUpcoming). The header is the roundel with the glass
// Messages button. Then the Notifications off line (decision 125), anything
// waiting on you (pairings to review, a bye), and every match still to play,
// league, playoff and Discover, in date order under "Upcoming matches".
//
// The first match is the D2 card (NextMatchCard), with the same actions as
// Match detail and the league page (finding 54, decision 199, John, Nov 12):
// Record with Ball Boi (singles), then Message and Enter score. There's no
// Details button; tapping the card opens Match detail, like the rows under
// it. Doubles shows the note on why Ball Boi can't record it yet.
//
// Past due (finding 47, John, Nov 12): an hour after the start with no score
// it reads "Earlier today · 6:30 PM", Enter score and Message lead, and Record
// with Ball Boi is a text link. A match still ahead today leads
// over a past-due one. The next day the late-match and "Did it happen?" flows
// take over.
//
// Season stats, standings and results don't live here any more: standings
// are on the league page and results on Profile. See all opens Profile's
// Upcoming matches tab.
// Home refreshes on pull and each time you come back to it (C4).

export default function HomeScreen() {
  const c = useColors();
  const bottom = useScreenBottomInset({ tab: true });
  const router = useRouter();
  const { items, week, isLoading, isError, isRefetching, refetch } = useUpcomingMatches();
  const pull = usePullToRefresh(refetch);
  const openUpcoming = useOpenUpcoming();
  const { profile } = useProfile();
  const myName = profile?.displayName ?? "You";

  const openLeague = (leagueId: number) => router.push(`/league/${leagueId}`);
  // See all opens your matches on Profile, scrolled to Upcoming matches (decision 138).
  const seeAll = () => router.navigate({ pathname: "/(tabs)/profile", params: { tab: "upcoming", at: String(Date.now()) } });

  const { message: upcomingMessage } = useUpcomingMessage();

  const firstCard = (m: UpcomingItem) => {
    const opponent = m.opponentName ?? "your opponent";
    const when = cardWhen(m);
    // The same actions as Match detail and the league page (finding 54,
    // decision 199): Record with Ball Boi, then Message and Enter score;
    // past due, Enter score leads and Record is a link (finding 47).
    const actions = upcomingActions(m, { matchTimeAllowed: false });
    const record: NextMatchAction | null = actions.record
      ? {
          label: "Record with Ball Boi",
          onPress: () => openRecorder(router, { matchId: m.matchId!, opponentName: opponent, leagueId: m.leagueId }),
          hint: `Records your match against ${opponent}`,
        }
      : null;
    // D6: a doubles league match's Message opens one chat for all four.
    const message = upcomingMessage(m);
    // League and playoff scores go to the league's Enter score; a Discover match's to its own.
    const enterScore: NextMatchAction | null = !actions.enterScore
      ? null
      : m.leagueId != null && m.kind !== "discover"
        ? {
            label: "Enter score",
            hint: `For your match against ${opponent}`,
            onPress: () => router.push({ pathname: "/league/[leagueId]/score/[matchId]", params: { leagueId: String(m.leagueId), matchId: String(m.matchId) } }),
          }
        : {
            label: "Enter score",
            hint: `For your match against ${opponent}`,
            onPress: () => router.push({ pathname: "/record/score/[matchId]", params: { matchId: String(m.matchId), opponent } }),
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
        enterScore={enterScore}
        pastDue={actions.pastDue}
        // No Details button: the card itself opens the match, like the rows under it (finding 54).
        onPress={() => openUpcoming(m)}
        hint={m.kind === "discover" ? upcomingHint(m) : m.matchId ? undefined : "Opens the league"}
        footer={actions.doublesNote ? <DoublesNote matchId={m.matchId!} /> : null}
      />
    );
  };

  // Anything waiting on you: an admin's pairings to review, and a bye.
  const drafts = week?.drafts ?? [];
  const byes = (week?.thisWeek ?? []).filter((i) => i.bye);
  const waiting = drafts.length + byes.length;
  // An open match has no one face to show, so it's always a row. A match still
  // ahead today leads over a past-due one (finding 47); the rest stay in date order.
  const firstAt = items[0] && items[0].kind !== "open" ? heroIndex(items, new Date(), (m) => m.kind !== "open") : -1;
  const first = firstAt >= 0 ? items[firstAt] : null;
  const rest = first ? items.filter((_, n) => n !== firstAt) : items;
  const nothing = !isLoading && !!week && items.length === 0 && waiting === 0;

  return (
    <TabScreen title="Home" roundel={!nothing} bare={nothing}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
        </View>
      ) : nothing ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: bottom.paddingBottom }}
          scrollIndicatorInsets={bottom.scrollIndicatorInsets}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
        >
          <View style={{ padding: spacing.space4, gap: spacing.space3 }}>
            <OfflineNotice pull={pull} />
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
          contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space3 }}
          scrollIndicatorInsets={bottom.scrollIndicatorInsets}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
        >
          <OfflineNotice pull={pull} />
          {/* Nothing to show yet: the full error. With matches on screen, the notice above says they may be old (decision 195). */}
          {isError && !week ? (
            <ProblemCard
              title="Can't load your matches"
              body="Check your connection and try again."
              onRetry={() => void refetch()}
              retrying={isRefetching}
            />
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
