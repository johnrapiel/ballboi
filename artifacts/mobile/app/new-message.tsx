import { Stack, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, SectionList, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { SearchField } from "@/components/players/SearchField";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useMessagesActions } from "@/hooks/useMessages";
import { usePlayerSearch } from "@/hooks/usePlayerSearch";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { canMessage, newMessageSections, noResultsMessage, personKey, type PlayerSearchResult } from "@/lib/playerSearch";

// New message (finding #18, John Nov 6): a search bar at the top, then two
// sections, "In your leagues" and "All Ball Boi players". Search filters both.
// "All Ball Boi players" is anyone who hasn't hidden their profile, never
// blocked players (the server's player search). Picking someone you already
// chat with opens that chat.

type Section = { key: "leagues" | "everyone"; title: string; empty: string; data: PlayerSearchResult[] };

function PlayerRow({ player, busy, onPress }: { player: PlayerSearchResult; busy: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Message ${player.name}`}
      accessibilityState={{ busy }}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
        borderBottomWidth: 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar name={player.name} uri={player.avatarUrl} size={36} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {player.name}
      </Text>
      {busy ? <ActivityIndicator color={c.ink} /> : null}
    </Pressable>
  );
}

export default function NewMessageScreen() {
  const c = useColors();
  const router = useRouter();
  const bottom = useScreenBottomInset();
  const actions = useMessagesActions();
  const [query, setQuery] = useState("");
  const search = usePlayerSearch(query);
  const [opening, setOpening] = useState<string | null>(null);

  // Opens your existing chat with them if there is one, else a new one.
  async function pick(player: PlayerSearchResult) {
    if (!canMessage(player) || opening) return;
    const key = personKey(player);
    setOpening(key);
    let existing: number | null = null;
    // By league player when they have one, else by account (a Discover player).
    const who = player.playerId != null ? { playerId: String(player.playerId) } : { userId: String(player.userId) };
    try {
      existing = (
        player.playerId != null
          ? await actions.conversationWithPlayer(player.playerId)
          : await actions.conversationWithUser(player.userId!)
      ).conversationId;
    } catch {
      // The conversation screen looks again, so a failed lookup still can't make a duplicate.
    }
    setOpening(null);
    router.replace(
      existing
        ? { pathname: "/conversation/[id]", params: { id: String(existing) } }
        : { pathname: "/conversation/[id]", params: { id: "new", ...who, name: player.name } },
    );
  }

  const data = search.data;
  const { leagues, everyone } = newMessageSections(data?.players ?? []);
  const typed = search.query.length > 0;
  const sections: Section[] = [
    {
      key: "leagues",
      title: "In your leagues",
      empty: typed ? "No one in your leagues by that name." : "Join or start a league to see your league mates here.",
      data: leagues,
    },
    {
      key: "everyone",
      title: "All Ball Boi players",
      empty: "No other players by that name.",
      data: everyone,
    },
  ];
  const nothing = leagues.length === 0 && everyone.length === 0;
  const none = noResultsMessage(search.query, "newMessage");

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: "minimal",
          title: "New message",
          headerShadowVisible: false,
          headerTintColor: c.ink,
          headerStyle: { backgroundColor: c.paper },
          headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: c.ink },
        }}
      />
      <View style={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space2, paddingBottom: spacing.space3 }}>
        <SearchField value={query} onChangeText={setQuery} busy={search.searching && !!data} />
      </View>

      {search.isPending ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading players" />
      ) : search.isError && !data ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text tone="inkMuted" accessibilityRole="alert" style={{ textAlign: "center" }}>
            {isOfflineError(search.error) ? OFFLINE_MESSAGE : "Players didn't load. Try again."}
          </Text>
          <Button label="Try again" variant="secondary" loading={search.isRefetching} onPress={() => search.refetch()} />
        </View>
      ) : nothing && typed ? (
        <EmptyState symbol="magnifyingglass" title={none.title} message={none.message} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={personKey}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: bottom.paddingBottom }}
          scrollIndicatorInsets={bottom.scrollIndicatorInsets}
          renderSectionHeader={({ section }) => (
            <Text
              variant="label"
              tone="inkMuted"
              accessibilityRole="header"
              style={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space4, paddingBottom: spacing.space2 }}
            >
              {section.title}
            </Text>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <Text tone="inkMuted" style={{ paddingHorizontal: spacing.space4, paddingBottom: spacing.space2 }}>
                {(section as Section).empty}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <PlayerRow player={item} busy={opening === personKey(item)} onPress={() => pick(item)} />
          )}
          ListHeaderComponent={
            search.isError ? (
              <View style={{ paddingHorizontal: spacing.space4, gap: spacing.space2, alignItems: "flex-start" }}>
                <Text tone="danger" accessibilityRole="alert">
                  {isOfflineError(search.error) ? OFFLINE_MESSAGE : "That search didn't finish. These results are from before."}
                </Text>
                <Button label="Try again" variant="secondary" loading={search.isRefetching} onPress={() => search.refetch()} />
              </View>
            ) : undefined
          }
          ListFooterComponent={
            data?.more ? (
              <Text tone="inkMuted" style={{ padding: spacing.space4 }}>
                Showing the first {everyone.length} players. Type more of a name to find someone else.
              </Text>
            ) : undefined
          }
        />
      )}
    </View>
  );
}
