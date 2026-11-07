// Discover (spec: Discover; Wave 2 Session F, F1): find people and games
// near your ZIP. Your area with Change, three tabs (Players, Open leagues,
// Open matches), and the distance chips with a count on each. One distance
// for all three tabs, saved for next time. Canvas: "Wave 2 designs",
// W2_Discover and its states.

import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AreaRow,
  DiscoverTabs,
  DistanceChips,
  FiltersButton,
  LinkButton,
} from "@/components/discover/Controls";
import { PlayerRow } from "@/components/discover/PlayerRow";
import {
  EmptyBlock,
  NoteCard,
  ProblemCard,
  SkeletonRows,
} from "@/components/discover/States";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  useDiscoverMe,
  useDiscoverPlayers,
  useSaveRadius,
} from "@/hooks/useDiscover";
import { discoverState, useDiscoverState } from "@/hooks/useDiscoverFilters";
import { isOfflineError } from "@/lib/api";
import {
  RADIUS_STEPS,
  countFor,
  countLine,
  filtersSpoken,
  inviteMessage,
  type DiscoverTab,
} from "@/lib/discover";

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
  const players = useDiscoverPlayers(
    radius,
    filters,
    !!me.data && tab === "players",
  );

  async function refresh() {
    setRefreshing(true);
    await Promise.all([
      me.refetch(),
      tab === "players" ? players.refetch() : Promise.resolve(),
    ]);
    setRefreshing(false);
  }

  const area = me.data?.area ?? null;
  const changeArea = () => router.push("/discover/area");

  return (
    <TabScreen title="Discover">
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.space4,
          paddingBottom: insets.bottom + 96,
          gap: spacing.space3,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={c.ink}
          />
        }
      >
        <AreaRow area={area} onPress={changeArea} />
        <DiscoverTabs
          value={tab}
          onChange={(t: DiscoverTab) => discoverState.setTab(t)}
        />

        {me.isError && !me.data ? (
          <ProblemCard
            title="Can't load Discover right now"
            body="Check your connection and try again."
            onRetry={() => void me.refetch()}
            retrying={me.isRefetching}
          />
        ) : tab === "players" ? (
          <PlayersTab />
        ) : (
          <ComingTab tab={tab} />
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
  const noTimes = me.data != null && me.data.hoursFree === 0;

  const saveRadius = useSaveRadius();
  const pickRadius = (r: number) => {
    discoverState.setRadius(r);
    saveRadius.mutate(r);
  };
  const openFilters = () => router.push("/discover/filters");
  const setTimes = () => router.push("/availability");

  const widenTo =
    RADIUS_STEPS.find((r) => r > radius && (countFor(counts, r) ?? 0) > 0) ??
    RADIUS_STEPS.find((r) => r > radius);

  async function invite() {
    try {
      await Share.share({ message: inviteMessage(me.data?.area?.zip ?? null) });
    } catch {
      // Closing the share sheet is fine.
    }
  }

  return (
    <>
      <DistanceChips
        radius={radius}
        counts={counts}
        noun="players"
        onPick={pickRadius}
        onCustom={() => router.push("/discover/radius")}
      />

      {me.data?.hidden ? (
        <NoteCard
          symbol="eye.slash"
          title="You're hidden from Discover"
          body="Players near you can't find you. You can still browse, message and join matches."
          action={
            <LinkButton
              label="Change in Settings"
              onPress={() => router.push("/settings")}
            />
          }
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
        <Text
          variant="small"
          tone="inkMuted"
          accessibilityLiveRegion="polite"
          style={{ flexShrink: 1 }}
        >
          {loading || players.isFetching
            ? `Finding players within ${radius} mi…`
            : players.isError && !data
              ? `Within ${radius} mi`
              : countLine(n, radius)}
        </Text>
        <FiltersButton
          onPress={openFilters}
          accessibilityLabel={`Filters: ${filtersSpoken(filters)}`}
        />
      </View>

      {noTimes ? (
        <NoteCard
          symbol="calendar"
          body="Add when you can play to find players free when you are."
          action={
            <LinkButton
              label="Set times"
              accessibilityLabel="Set times: when you can play"
              onPress={setTimes}
            />
          }
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
          <Button
            label="Add your ZIP"
            onPress={() => router.push("/discover/area")}
          />
        </EmptyBlock>
      ) : data && data.players.length === 0 ? (
        <EmptyBlock
          title={`No players within ${radius} mi`}
          body={`Ball Boi is new${me.data?.area ? ` near ${me.data.area.zip}` : " here"}. Try a wider distance, post an open match, or invite friends who play.`}
        >
          {widenTo ? (
            <Button
              label={`Widen to ${widenTo} mi`}
              onPress={() => pickRadius(widenTo)}
            />
          ) : null}
          <Button
            label="Post an open match"
            variant="secondary"
            onPress={() => discoverState.setTab("matches")}
          />
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

/** Open leagues and Open matches arrive in the next two Discover PRs. */
function ComingTab({ tab }: { tab: DiscoverTab }) {
  return (
    <EmptyBlock
      title={tab === "leagues" ? "Open leagues" : "Open matches"}
      body={
        tab === "leagues"
          ? "Open leagues near you show up here."
          : "Open matches near you show up here."
      }
    />
  );
}
