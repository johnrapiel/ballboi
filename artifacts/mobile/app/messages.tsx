import { Stack, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderIconButton } from "@/components/Choice";
import { EmptyState } from "@/components/EmptyState";
import { ConversationRow } from "@/components/messages/ConversationRow";
import { ModerationRow } from "@/components/moderation/ModerationRow";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useConversations, useMessagesActions } from "@/hooks/useMessages";

// Messages (spec: Messaging and moderation; approved canvas: Messages, opened
// from the Messages button in the top corner of every tab). A brush title and
// one list: every message goes straight here, with no Message Requests (John,
// Nov 6, finding 17). New message stays at the top right and lists league
// mates; anyone else is messaged from their player card. The Moderation row
// shows for the admin only.

export default function MessagesScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useConversations();
  const actions = useMessagesActions();
  const [addingSamples, setAddingSamples] = useState(false);

  const conversations = query.data?.conversations ?? [];

  const open = (id: number) => router.push({ pathname: "/conversation/[id]", params: { id: String(id) } });

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
      <Text variant="brushM" accessibilityRole="header" style={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space2, paddingBottom: spacing.space3 }}>
        Messages
      </Text>
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
          <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
            <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
              Messages didn't load. {query.error.message}
            </Text>
            <Button label="Try again" variant="secondary" onPress={() => query.refetch()} />
          </View>
        </>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => open(item.id)} />}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.ink} />}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + spacing.space6 }}
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
