// Another player's card from Discover (decision 139: the same card everywhere,
// Discover included; decision 143: their matches below it, John, Nov 8).
// Card D with the distance beside the town; no pencil, and Free times has no
// Edit. This season's Record, Played, Streak and No-shows sit under it, then
// the head-to-head line when you've played them, then the same Upcoming
// matches and Results tabs as your own Profile. Results show both names with
// the winner mark and the score from the winner's side. More (•••) opens
// Report, as before, and "Set up a match" stays pinned at the bottom.
//
// Blocked either way, or a hidden profile: "isn't in Discover right now".

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetPlayerCardQueryKey,
  getGetPlayerMatchesQueryKey,
  useGetPlayerCard,
  useGetPlayerMatches,
  type PlayerMatches,
} from "@workspace/api-client-react";

import { EmptyTab, MatchTabs } from "@/components/card/MatchTabs";
import { PlayerCard } from "@/components/card/PlayerCard";
import { SeasonRow } from "@/components/card/SeasonRow";
import { HeaderIconButton } from "@/components/Choice";
import { ProblemCard } from "@/components/discover/States";
import { Icon } from "@/components/Icon";
import { Button, Card, Text } from "@/components/ui";
import { UpcomingRows } from "@/components/UpcomingRows";
import { WinnerNames } from "@/components/WinnerNames";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useReportBlock } from "@/hooks/useReportBlock";
import { isOfflineError } from "@/lib/api";
import { headToHeadLine, otherUpcomingItem, resultMeta, type MatchTab } from "@/lib/playerCard";
import { winnerMark } from "@/lib/winnerMark";

const notFound = (e: unknown) => (e as { status?: number } | null)?.status === 404;

export default function PlayerCardScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = Number(params.userId);
  const valid = Number.isInteger(userId) && userId > 0;
  const cardQ = useGetPlayerCard(userId, { query: { enabled: valid, queryKey: getGetPlayerCardQueryKey(userId), retry: (n, e) => n < 2 && !notFound(e) } });
  const matchesQ = useGetPlayerMatches(userId, {
    query: { enabled: valid, queryKey: getGetPlayerMatchesQueryKey(userId), retry: (n, e) => n < 2 && !notFound(e) },
  });
  const report = useReportBlock();
  const [tab, setTab] = useState<MatchTab>("upcoming");
  const p = cardQ.data;
  const first = p ? p.name.split(" ")[0] || p.name : "";

  function more() {
    if (!p) return;
    const title = `Report ${first}`;
    const go = () => report.open({ id: null, userId: p.userId, name: p.name });
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: [title, "Cancel"], cancelButtonIndex: 1 }, (i) => {
        if (i === 0) go();
      });
    } else {
      Alert.alert(p.name, undefined, [
        { text: title, onPress: go },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  // Setting up a match happens in chat (F2): open your chat with them.
  function setUpMatch() {
    if (!p) return;
    router.push({ pathname: "/conversation/[id]", params: { id: "new", userId: String(p.userId), name: p.name } });
  }

  const refresh = () => {
    void cardQ.refetch();
    void matchesQ.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: p ? () => <HeaderIconButton symbol="ellipsis" label={`More options for ${p.name}`} onPress={more} /> : undefined,
        }}
      />
      {cardQ.isLoading ? (
        <View style={{ padding: spacing.space4 }} accessible accessibilityLabel="Loading player">
          <Card style={{ height: 320, backgroundColor: c.sand, borderColor: c.sand }} />
        </View>
      ) : !p ? (
        <View style={{ padding: spacing.space4, gap: spacing.space3 }}>
          {notFound(cardQ.error) || !valid ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="title">This player isn't in Discover right now</Text>
              <Text tone="inkMuted">They may have hidden their profile. Find someone else near you.</Text>
              <Button label="Back to Discover" variant="secondary" onPress={() => router.back()} />
            </Card>
          ) : (
            <ProblemCard
              title="Can't load this player right now"
              body={isOfflineError(cardQ.error) ? "You're offline. Check your connection and try again." : "Check your connection and try again."}
              onRetry={() => void cardQ.refetch()}
              retrying={cardQ.isRefetching}
            />
          )}
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ padding: spacing.space4, paddingBottom: 120 + insets.bottom, gap: spacing.space6 }}
            refreshControl={<RefreshControl refreshing={cardQ.isRefetching || matchesQ.isRefetching} onRefresh={refresh} tintColor={c.ink} />}
          >
            <PlayerCard card={p} onFreeTimes={() => router.push({ pathname: "/free-times", params: { userId: String(p.userId) } })} />
            <SeasonRow season={p.season} />
            <TheirMatches name={p.name} q={matchesQ} tab={tab} onTab={setTab} />
          </ScrollView>
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: spacing.space4,
              paddingTop: spacing.space3,
              paddingBottom: insets.bottom + spacing.space3,
              borderTopWidth: 1,
              borderTopColor: c.hairline,
              backgroundColor: c.paper,
            }}
          >
            <Button label="Set up a match" onPress={setUpMatch} accessibilityHint={`Opens your chat with ${p.name}`} />
          </View>
        </>
      )}
    </View>
  );
}

/** Head-to-head, then their Upcoming matches and Results tabs. */
function TheirMatches({
  name,
  q,
  tab,
  onTab,
}: {
  name: string;
  q: { data?: PlayerMatches; isLoading: boolean; isError: boolean; isRefetching: boolean; refetch: () => unknown };
  tab: MatchTab;
  onTab: (t: MatchTab) => void;
}) {
  const c = useColors();
  const router = useRouter();
  const first = name.split(" ")[0] || name;
  const data = q.data;
  const upcoming = (data?.upcoming ?? []).map(otherUpcomingItem);
  const results = data?.results ?? [];
  const h2h = data?.headToHead ? headToHeadLine(name, data.headToHead) : null;

  return (
    <View style={{ gap: spacing.space2 }}>
      {h2h ? (
        <Text accessibilityLabel={h2h.spoken} variant="bodyStrong" style={{ paddingHorizontal: spacing.space1, fontVariant: ["lining-nums", "tabular-nums"] }}>
          {h2h.text}
        </Text>
      ) : null}
      <MatchTabs tab={tab} onChange={onTab} counts={{ upcoming: upcoming.length, results: results.length }} />
      {q.isLoading ? (
        <Text tone="inkMuted" style={{ paddingHorizontal: spacing.space1 }}>
          Loading matches…
        </Text>
      ) : q.isError && !data ? (
        <Card style={{ gap: spacing.space3 }}>
          <Text variant="bodyStrong">Couldn't load {first}'s matches</Text>
          <Button label="Try again" variant="secondary" loading={q.isRefetching} onPress={() => void q.refetch()} />
        </Card>
      ) : tab === "upcoming" ? (
        upcoming.length === 0 ? (
          <EmptyTab title="No upcoming matches" message={`When ${first} has a match coming up, it shows up here.`} />
        ) : (
          <UpcomingRows
            items={upcoming}
            // Only your own matches open, on Match detail.
            canOpen={(m) => !!m.matchId && (data?.upcoming.find((u) => u.key === m.key)?.mine ?? false) && m.kind !== "discover"}
            onOpen={(m) => router.push(`/match/${m.matchId}`)}
            hint={() => "Opens the match"}
          />
        )
      ) : results.length === 0 ? (
        <EmptyTab title="No results yet" message={`${first}'s scored matches show up here.`} />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {results.map((r, n) => {
            const mark = winnerMark({ player1Name: r.player1Name, player2Name: r.player2Name, score: r.score, winner: r.winner === 1 || r.winner === 2 ? r.winner : null });
            const meta = resultMeta(r);
            const spoken = `${mark.spoken}. ${r.player1Name} versus ${r.player2Name}. ${meta.replace(/ · /g, ", ")}`;
            // Only your own matches open Match detail, whatever the type (decision 151).
            const opens = r.mine;
            const row = {
              minHeight: 56,
              flexDirection: "row" as const,
              alignItems: "center" as const,
              gap: spacing.space3,
              paddingHorizontal: spacing.space4,
              paddingVertical: spacing.space3,
              borderBottomWidth: n === results.length - 1 ? 0 : 1,
              borderBottomColor: c.hairline,
            };
            const body = (
              <>
                <View style={{ flex: 1, gap: spacing.space1 }}>
                  <WinnerNames player1Name={r.player1Name} player2Name={r.player2Name} mark={mark} />
                  <Text variant="small" tone="inkMuted">
                    {meta}
                  </Text>
                </View>
                {opens ? <Icon name="chevron.right" size={13} tintColor={c.inkMuted} /> : null}
              </>
            );
            return opens ? (
              <Pressable
                key={r.matchId}
                onPress={() => router.push(`/match/${r.matchId}`)}
                accessibilityRole="button"
                accessibilityLabel={spoken}
                accessibilityHint="Opens the match"
                style={({ pressed }) => [row, { opacity: pressed ? 0.7 : 1 }]}
              >
                {body}
              </Pressable>
            ) : (
              <View key={r.matchId} accessible accessibilityLabel={spoken} style={row}>
                {body}
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}
