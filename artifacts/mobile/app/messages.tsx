import { Stack, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton } from "@/components/Choice";
import { EmptyState } from "@/components/EmptyState";
import { BoxSwitch, ConversationRow } from "@/components/messages/ConversationRow";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useConversations, useMessagesActions } from "@/hooks/useMessages";

// Messages (spec: Messaging and moderation; opens from the Messages button in
// the top corner of every tab). Direct chats, and Message Requests: first
// messages from players outside your leagues. New message (top right) lists
// league mates; anyone else is messaged from their player card.

export default function MessagesScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState<"messages" | "requests">("messages");
  const query = useConversations(box);
  const actions = useMessagesActions();
  const [addingSamples, setAddingSamples] = useState(false);

  const conversations = query.data?.conversations ?? [];
  const requests = query.data?.requests ?? 0;

  const open = (id: number) => router.push({ pathname: "/conversation/[id]", params: { id: String(id) } });

  const onRefresh = () => {
    void query.refetch();
  };

  const addSamples = () => {
    setAddingSamples(true);
    actions
      .addSamples()
      .then(actions.refresh)
      .catch((e: Error) => Alert.alert("Couldn't add samples", e.message))
      .finally(() => setAddingSamples(false));
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          headerRight: () => <IconButton symbol="square.and.pencil" label="New message" onPress={() => router.push("/new-message")} />,
        }}
      />
      <View style={{ paddingTop: spacing.space3 }}>
        <BoxSwitch value={box} onChange={setBox} requests={requests} />
      </View>

      {query.isPending ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading messages" />
      ) : query.isError && !query.data ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
            Messages didn't load. {query.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => open(item.id)} />}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={onRefresh} tintColor={c.ink} />}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + spacing.space6 }}
          ListHeaderComponent={
            box === "requests" && conversations.length ? (
              <Text variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space4, paddingBottom: spacing.space3 }}>
                First messages from players outside your leagues. They can't send more until you reply, and they don't see if
                you've read them.
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={{ flex: 1, minHeight: 360 }}>
              {box === "messages" ? (
                <EmptyState
                  symbol="message"
                  title="No messages yet"
                  message="Message your league mates with New message, or players you find in Discover."
                />
              ) : (
                <EmptyState
                  symbol="tray"
                  title="No Message Requests"
                  message="First messages from players outside your leagues show up here."
                />
              )}
              {__DEV__ && box === "messages" ? (
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
