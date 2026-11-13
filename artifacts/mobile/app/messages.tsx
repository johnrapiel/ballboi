import { Stack, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from "react-native";

import { HeaderIconButton } from "@/components/Choice";
import { EmptyState } from "@/components/EmptyState";
import { ProblemCard } from "@/components/discover/States";
import { ConversationRow, GroupRow } from "@/components/messages/ConversationRow";
import { OfflineNotice } from "@/components/OfflineNotice";
import { ModerationRow } from "@/components/moderation/ModerationRow";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useConversations, useMessagesActions, type Conversation, type GroupConversation } from "@/hooks/useMessages";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";

// Messages (spec: Messaging and moderation; approved canvas: Messages, opened
// from the Messages button in the top corner of every tab). A brush title and
// one list: every message goes straight here, with no Message Requests (John,
// Nov 6, finding 17). New message stays at the top right and lists league
// mates; anyone else is messaged from their player card. The Moderation row
// shows for the admin only. Open match group chats (F15) and league chats
// (decision 145) sit in the same list, newest first, named for the match or
// the league. A league chat shows from the moment you join, before anyone posts.

type Item = { kind: "conversation"; item: Conversation } | { kind: "group"; item: GroupConversation };
const lastAt = (i: Item) => i.item.lastMessage?.at ?? "";

export default function MessagesScreen() {
  const c = useColors();
  const router = useRouter();
  const bottom = useScreenBottomInset();
  const query = useConversations();
  const pull = usePullToRefresh(() => query.refetch());
  const actions = useMessagesActions();
  const [addingSamples, setAddingSamples] = useState(false);

  const items: Item[] = [
    ...(query.data?.conversations ?? []).map((item) => ({ kind: "conversation" as const, item })),
    ...(query.data?.groups ?? []).map((item) => ({ kind: "group" as const, item })),
  ].sort((a, b) => lastAt(b).localeCompare(lastAt(a)));

  const open = (id: number) => router.push({ pathname: "/conversation/[id]", params: { id: String(id) } });
  const openGroup = (id: number) => router.push({ pathname: "/conversation/group/[id]", params: { id: String(id) } });

  const addSamples = () => {
    setAddingSamples(true);
    actions
      .addSamples()
      .then(actions.refresh)
      .catch((e: Error) => Alert.alert("Couldn't add samples", e.message))
      .finally(() => setAddingSamples(false));
  };

  const header = (
    <View>
      <Text variant="headingM" accessibilityRole="header" style={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space2, paddingBottom: spacing.space3 }}>
        Messages
      </Text>
      <OfflineNotice pull={pull} style={{ marginHorizontal: spacing.space4, marginBottom: spacing.space3 }} />
      <ModerationRow />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => <HeaderIconButton symbol="square.and.pencil" label="New message" onPress={() => router.push("/new-message")} />,
        }}
      />

      {query.isPending ? (
        <>
          {header}
          <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading messages" />
        </>
      ) : query.isError && !query.data ? (
        <>
          {header}
          <View style={{ paddingHorizontal: spacing.space4 }}>
            <ProblemCard
              title="Can't load messages"
              body="Check your connection and try again."
              onRetry={() => void query.refetch()}
              retrying={query.isRefetching}
            />
          </View>
        </>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => `${i.kind}-${i.item.id}`}
          renderItem={({ item: i }) =>
            i.kind === "group" ? (
              <GroupRow group={i.item} onPress={() => openGroup(i.item.id)} />
            ) : (
              <ConversationRow conversation={i.item} onPress={() => open(i.item.id)} />
            )
          }
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: bottom.paddingBottom }}
          scrollIndicatorInsets={bottom.scrollIndicatorInsets}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={{ flex: 1, minHeight: 360 }}>
              {/* Names only what works today. Add Discover back once it can message players (Wave 2). */}
              <EmptyState symbol="message" title="No messages yet" message="Message your league mates with New message." />
              {__DEV__ ? (
                // Development builds only: sample chats to try every screen with one phone.
                <View style={{ alignItems: "center", paddingBottom: spacing.space8 }}>
                  <Button label="Add sample conversations" variant="secondary" loading={addingSamples} onPress={addSamples} />
                </View>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}
