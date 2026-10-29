import { Stack, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Avatar } from "@/components/messages/ConversationRow";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useContacts } from "@/hooks/useMessages";

// New message: pick a league mate.
// Players outside your leagues are messaged from their player card.

export default function NewMessageScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const contacts = useContacts();

  const pick = (playerId: number, name: string) =>
    router.replace({ pathname: "/conversation/[id]", params: { id: "new", playerId: String(playerId), name } });

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
      {contacts.isPending ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading league mates" />
      ) : contacts.isError ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }}>
            League mates didn't load. {contacts.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => contacts.refetch()} />
        </View>
      ) : (
        <FlatList
          data={contacts.data.contacts}
          keyExtractor={(p) => String(p.playerId)}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + spacing.space6 }}
          ListHeaderComponent={
            contacts.data.contacts.length ? (
              <Text variant="label" tone="inkMuted" accessibilityRole="header" style={{ padding: spacing.space4, paddingBottom: spacing.space2 }}>
                League mates
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => pick(item.playerId, item.name)}
              accessibilityRole="button"
              accessibilityLabel={`Message ${item.name}`}
              style={({ pressed }) => ({
                minHeight: 60,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.space3,
                paddingHorizontal: spacing.space4,
                borderBottomWidth: 1,
                borderBottomColor: c.hairline,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Avatar name={item.name} size={36} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {item.name}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              symbol="person.2"
              title="No league mates yet"
              message="Join or start a league to message the players in it."
            />
          }
        />
      )}
    </View>
  );
}
