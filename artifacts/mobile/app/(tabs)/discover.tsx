// Discover (spec: Discover; Wave 2 Session F, F1): find people and games
// near your ZIP. Your area with Change, three tabs (Players, Open leagues,
// Open matches), and a count line with Filters on each tab. Distance lives in
// Filters only, never as a chip row on the tab (John, Nov 7). One distance
// for all three tabs, saved for next time. Canvas: "Wave 2 designs",
// W2_Discover and its states.

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton } from "@/components/Choice";
import { AreaRow, DiscoverTabs, FiltersButton, LinkButton } from "@/components/discover/Controls";
import { LeagueCard } from "@/components/discover/LeagueCard";
import { MatchAlertsCard } from "@/components/discover/MatchAlerts";
import { OpenMatchCard } from "@/components/discover/OpenMatchCard";
import { PlayerRow } from "@/components/discover/PlayerRow";
import { EmptyBlock, NoteCard, ProblemCard, SkeletonRows } from "@/components/discover/States";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscoverMe, useDiscoverPlayers, useSaveRadius } from "@/hooks/useDiscover";
import { discoverState, useDiscoverState } from "@/hooks/useDiscoverFilters";
import { useDiscoverLeagues } from "@/hooks/useDiscoverLeagues";
import { useOpenMatches } from "@/hooks/useDiscoverOpenMatches";
import { isOfflineError } from "@/lib/api";
import { RADIUS_STEPS, countFor, countLine, filtersSpoken, inviteMessage, type DiscoverTab, type PlayFilter } from "@/lib/discover";
import { SegmentedTabs } from "@/components/league/SegmentedTabs";

export default function DiscoverScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tab, radius, filters } = useDiscoverState();
  const me = useDiscoverMe();

  // The saved distance, once; Profile may have changed the ZIP, so refresh on focus.
  useEffect(() => {
    if (me.data) discoverState.loadRadius(me.data.radius);
  }, [me.data]);
  useFocusEffect(
    useCallback(() => {
      void me.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const [refreshing, setRefreshing] = useState(false);
  const players = useDiscoverPlayers(radius, filters, !!me.data && tab === "players");
  const leagues = useDiscoverLeagues(radius, !!me.data && tab === "leagues");
  const matches = useOpenMatches(radius, !!me.data && tab === "matches");

  // Pull to refresh reloads your area and the list on the tab you're on.
  async function refresh() {
    setRefreshing(true);
    const list = tab === "players" ? players : tab === "leagues" ? leagues : matches;
    try {
      await Promise.all([me.refetch(), list.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  const area = me.data?.area ?? null;
  const changeArea = () => router.push("/discover/area");

  // Open matches' own action is the glass + in the top corner, left of
  // Messages (button standard; John, Nov 9). Players and Open leagues have none.
  const action =
    tab === "matches" ? (
      <IconButton symbol="plus" label="Post an open match" onPress={() => router.push("/discover/match/new")} />
    ) : undefined;

  return (
    <TabScreen title="Discover" action={action}>
      <ScrollView
        style={{ flex: 1 }}
        // Keep iOS from shifting the list under the title (the area line was
        // clipped at the top, John, Nov 9). A little room above the area line too.
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={{
          paddingTop: spacing.space2,
          paddingHorizontal: spacing.space4,
          paddingBottom: insets.bottom + 96,
          gap: spacing.space3,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.ink} />}
      >
        <AreaRow area={area} onPress={changeArea} />
        <DiscoverTabs value={tab} onChange={(t: DiscoverTab) => discoverState.setTab(t)} />

        {me.isError && !me.data ? (
          <ProblemCard
            title="Can't load Discover right now"
            body="Check your connection and try again."
            onRetry={() => void me.refetch()}
            retrying={me.isRefetching}
          />
        ) : tab === "players" ? (
          <PlayersTab />
        ) : tab === "leagues" ? (
          <LeaguesTab />
        ) : (
          <MatchesTab />
        )}
      </ScrollView>
    </TabScreen>
  );
}

function PlayersTab() {
  const router = useRouter();
  const { radius, filters } = useDiscoverState();
  const me = useDiscoverMe();
  const players = useDiscoverPlayers(radius, filters, !!me.data);
  const data = players.data;
  const loading = !data && (players.isLoading || me.isLoading);
  const counts = data?.counts ?? [];
  const n = data?.total ?? countFor(counts, radius) ?? 0;
  const noTimes = me.data != null && (me.data.freeTimes ?? []).length === 0;

  const saveRadius = useSaveRadius();
  const pickRadius = (r: number) => {
    discoverState.setRadius(r);
    saveRadius.mutate(r);
  };
  const openFilters = () => router.push("/discover/filters");
  const setTimes = () => router.push("/availability");

  const widenTo = RADIUS_STEPS.find((r) => r > radius && (countFor(counts, r) ?? 0) > 0) ?? RADIUS_STEPS.find((r) => r > radius);

  async function invite() {
    try {
      await Share.share({ message: inviteMessage(me.data?.area?.zip ?? null) });
    } catch {
      // Closing the share sheet is fine.
    }
  }

  return (
    <>
      {me.data?.hidden ? (
        <NoteCard
          symbol="eye.slash"
          title="You're hidden from Discover"
          body="Players near you can't find you. You can still browse, message and join matches."
          action={<LinkButton label="Change in Settings" onPress={() => router.push("/settings")} />}
        />
      ) : null}

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.space2,
        }}
      >
        <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite" style={{ flexShrink: 1 }}>
          {loading || players.isFetching
            ? `Finding players within ${radius} mi…`
            : players.isError && !data
              ? `Within ${radius} mi`
              : countLine(n, radius)}
        </Text>
        <FiltersButton onPress={openFilters} accessibilityLabel={`Filters: ${filtersSpoken(filters, radius)}`} />
      </View>

      {noTimes ? (
        <NoteCard
          symbol="calendar"
          body="Add when you can play to find players free when you are."
          action={<LinkButton label="Set times" accessibilityLabel="Set times: when you can play" onPress={setTimes} />}
        />
      ) : null}

      {loading ? (
        <SkeletonRows />
      ) : players.isError && !data ? (
        <ProblemCard
          title="Can't load players right now"
          body={
            isOfflineError(players.error)
              ? "You're offline. Check your connection and try again. Your filters and distance stay as they are."
              : "Check your connection and try again. Your filters and distance stay as they are."
          }
          onRetry={() => void players.refetch()}
          retrying={players.isRefetching}
        />
      ) : data?.needsArea ? (
        <EmptyBlock
          title="Add your ZIP"
          body="Discover shows players near your home ZIP. Others only see your town and an approximate distance."
        >
          <Button label="Add your ZIP" onPress={() => router.push("/discover/area")} />
        </EmptyBlock>
      ) : data && data.players.length === 0 ? (
        <EmptyBlock
          title={`No players within ${radius} mi`}
          body={`Ball Boi is new${me.data?.area ? ` near ${me.data.area.zip}` : " here"}. Try a wider distance, post an open match, or invite friends who play.`}
        >
          {widenTo ? <Button label={`Widen to ${widenTo} mi`} onPress={() => pickRadius(widenTo)} /> : null}
          <Button label="Post an open match" variant="secondary" onPress={() => router.push("/discover/match/new")} />
          <Button
            label="Invite a friend"
            variant="secondary"
            onPress={() => void invite()}
            accessibilityHint="Opens the share sheet with your invite link"
          />
        </EmptyBlock>
      ) : data ? (
        <>
          {data.total > data.players.length ? (
            <Text
              variant="small"
              tone="inkMuted"
            >{`Showing the nearest ${data.players.length}. Pick a shorter distance or add filters to narrow it.`}</Text>
          ) : null}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {data.players.map((p, i) => (
              <PlayerRow
                key={p.userId}
                player={p}
                last={i === data.players.length - 1}
                onPress={() =>
                  router.push({
                    pathname: "/discover/player/[userId]",
                    params: { userId: String(p.userId) },
                  })
                }
              />
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

/** Open leagues near you (brief items 17 to 22; canvas W2_DiscoverLeagues). */
function LeaguesTab() {
  const router = useRouter();
  const { radius } = useDiscoverState();
  const me = useDiscoverMe();
  // D8: the Format filter, All, Singles or Doubles.
  const [play, setPlay] = React.useState<PlayFilter>("all");
  const q = useDiscoverLeagues(radius, !!me.data, play);
  const saveRadius = useSaveRadius();
  const data = q.data;
  const counts = data?.counts ?? [];
  const pickRadius = (r: number) => {
    discoverState.setRadius(r);
    saveRadius.mutate(r);
  };
  const widenTo = RADIUS_STEPS.find((r) => r > radius && (countFor(counts, r) ?? 0) > 0) ?? RADIUS_STEPS.find((r) => r > radius);
  const loading = !data && (q.isLoading || me.isLoading);

  return (
    <>
      <CountRow radius={radius}>
        {loading || q.isFetching
          ? `Finding Open leagues within ${radius} mi…`
          : q.isError && !data
            ? `Within ${radius} mi`
            : countLine(data?.total ?? 0, radius, play === "all" ? "Open league" : play === "singles" ? "Open singles league" : "Open doubles league")}
      </CountRow>
      <SegmentedTabs
        choice
        label="Format"
        value={play}
        onChange={setPlay}
        tabs={[
          { value: "all", label: "All" },
          { value: "singles", label: "Singles" },
          { value: "doubles", label: "Doubles" },
        ]}
      />
      {loading ? (
        <SkeletonRows rows={3} />
      ) : q.isError && !data ? (
        <ProblemCard
          title="Can't load Open leagues right now"
          body={
            isOfflineError(q.error)
              ? "You're offline. Check your connection and try again."
              : "Check your connection and try again. Your distance stays as it is."
          }
          onRetry={() => void q.refetch()}
          retrying={q.isRefetching}
        />
      ) : data?.needsArea ? (
        <EmptyBlock title="Add your ZIP" body="Discover shows Open leagues near your home ZIP.">
          <Button label="Add your ZIP" onPress={() => router.push("/discover/area")} />
        </EmptyBlock>
      ) : data && data.leagues.length === 0 ? (
        <EmptyBlock
          title={`No Open ${play === "all" ? "" : `${play} `}leagues within ${radius} mi`}
          body={
            play === "all"
              ? "Try a wider distance, or start your own league and make it Open so players near you can ask for a spot."
              : `Try a wider distance, or show All formats.`
          }
        >
          {widenTo ? <Button label={`Widen to ${widenTo} mi`} onPress={() => pickRadius(widenTo)} /> : null}
          <Button label="Start a league" variant="secondary" onPress={() => router.push("/league/new")} />
        </EmptyBlock>
      ) : data ? (
        <View style={{ gap: spacing.space3 }}>
          {data.leagues.map((l) => (
            <LeagueCard
              key={l.leagueId}
              league={l}
              onPress={() => router.push({ pathname: "/discover/league/[leagueId]", params: { leagueId: String(l.leagueId) } })}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/** Open matches near you (brief items 38 to 46; canvas W2_DiscoverMatches). */
function MatchesTab() {
  const router = useRouter();
  const { radius } = useDiscoverState();
  const me = useDiscoverMe();
  const q = useOpenMatches(radius, !!me.data);
  const saveRadius = useSaveRadius();
  const data = q.data;
  const counts = data?.counts ?? [];
  const pickRadius = (r: number) => {
    discoverState.setRadius(r);
    saveRadius.mutate(r);
  };
  const widenTo = RADIUS_STEPS.find((r) => r > radius && (countFor(counts, r) ?? 0) > 0) ?? RADIUS_STEPS.find((r) => r > radius);
  const loading = !data && (q.isLoading || me.isLoading);
  const post = () => router.push("/discover/match/new");

  async function invite() {
    try {
      await Share.share({ message: inviteMessage(me.data?.area?.zip ?? null) });
    } catch {
      // Closing the share sheet is fine.
    }
  }

  return (
    <>
      <CountRow radius={radius}>
        {loading || q.isFetching
          ? `Finding open matches within ${radius} mi…`
          : q.isError && !data
            ? `Within ${radius} mi`
            : countLine(data?.total ?? 0, radius, "open match")}
      </CountRow>

      {data?.notices.map((n) => (
        <NoteCard
          key={`notice-${n.id}`}
          symbol="person.3.fill"
          title="This match filled up"
          body={`${n.when}${n.courtName ? ` at ${n.courtName}` : ""} is full. Here are other open matches near you.`}
        />
      ))}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : q.isError && !data ? (
        <ProblemCard
          title="Can't load open matches right now"
          body={
            isOfflineError(q.error)
              ? "You're offline. Check your connection and try again."
              : "Check your connection and try again. Your distance stays as it is."
          }
          onRetry={() => void q.refetch()}
          retrying={q.isRefetching}
        />
      ) : data?.needsArea ? (
        <EmptyBlock title="Add your ZIP" body="Discover shows open matches near your home ZIP.">
          <Button label="Add your ZIP" onPress={() => router.push("/discover/area")} />
        </EmptyBlock>
      ) : data && data.matches.length === 0 ? (
        <>
          <EmptyBlock title={`No open matches within ${radius} mi`} body="Post one and players nearby can join with one tap.">
            <Button label="Post an open match" variant="secondary" onPress={post} />
            {widenTo ? <Button label={`Widen to ${widenTo} mi`} variant="secondary" onPress={() => pickRadius(widenTo)} /> : null}
            <Button
              label="Invite friends"
              variant="secondary"
              onPress={() => void invite()}
              accessibilityHint="Opens the share sheet with your invite link"
            />
          </EmptyBlock>
          <MatchAlertsCard on={data.matchAlerts} />
        </>
      ) : data ? (
        <>
          <View style={{ gap: spacing.space3 }}>
            {data.matches.map((m) => (
              <OpenMatchCard
                key={m.id}
                match={m}
                onPress={() => router.push({ pathname: "/discover/match/[id]", params: { id: String(m.id) } })}
              />
            ))}
          </View>
          <MatchAlertsCard on={data.matchAlerts} />
        </>
      ) : null}
    </>
  );
}

/** "3 open matches within 10 mi" with Filters beside it (canvas W2_DiscoverFiltersDistance). */
function CountRow({ radius, children }: { radius: number; children: string }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.space2 }}>
      <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite" style={{ flexShrink: 1 }}>
        {children}
      </Text>
      <FiltersButton onPress={() => router.push("/discover/filters")} accessibilityLabel={`Filters: distance ${radius} miles`} />
    </View>
  );
}
