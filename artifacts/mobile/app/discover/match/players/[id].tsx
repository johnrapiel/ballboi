// Players in a filled open match (canvas W2_MembersSheet, W2_RemovePlayer;
// brief items 42 to 44). Everyone sees who's in. The poster can Remove a
// player (their spot reopens; they only hear "This match filled up") or
// cancel the match. A joiner can drop out. A bottom sheet by the sheet rule.

import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { AccessibilityInfo, Alert, Pressable, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { SheetBody } from "@/components/Sheet";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useOpenMatch, useOpenMatchAction } from "@/hooks/useDiscoverOpenMatches";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { firstName } from "@/lib/discover";

export default function PlayersSheet() {
  const c = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const q = useOpenMatch(id);
  const act = useOpenMatchAction(id);
  const m = q.data;
  const fail = (e: unknown) =>
    Alert.alert("Couldn't do that", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");

  function remove(userId: number, name: string) {
    const first = firstName(name);
    Alert.alert(`Remove ${first}?`, `Their spot opens back up in Discover. ${first} gets a note that the match filled up.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          act
            .mutateAsync({ action: "remove", userId })
            .then(() => AccessibilityInfo.announceForAccessibility(`${first} is out. Their spot is open again.`))
            .catch(fail),
      },
    ]);
  }

  function cancel() {
    Alert.alert(
      "Cancel this match?",
      "It's off everyone's schedule, and everyone gets a notification. Canceling before the match never counts as a no-show.",
      [
        { text: "Keep match", style: "cancel" },
        {
          text: "Cancel match",
          style: "destructive",
          onPress: () =>
            act
              .mutateAsync({ action: "cancel" })
              .then(() => router.dismissTo("/(tabs)/discover"))
              .catch(fail),
        },
      ],
    );
  }

  function drop() {
    Alert.alert(
      "Drop out?",
      "Your spot opens back up in Discover and the poster gets a notification. Dropping out before the match never counts as a no-show.",
      [
        { text: "Stay in", style: "cancel" },
        {
          text: "Drop out",
          style: "destructive",
          onPress: () =>
            act
              .mutateAsync({ action: "drop" })
              .then(() => router.dismissTo("/(tabs)/discover"))
              .catch(fail),
        },
      ],
    );
  }

  return (
    <SheetBody title="Players">
      {m ? (
        <>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {m.players.map((p, i) => (
              <View
                key={`${p.userId}-${i}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.space3,
                  padding: spacing.space3,
                  minHeight: 56,
                  borderBottomWidth: i === m.players.length - 1 ? 0 : 1,
                  borderBottomColor: c.hairline,
                }}
              >
                <Avatar name={p.name} uri={p.avatarUrl} size={36} />
                <View
                  style={{ flex: 1 }}
                  accessible
                  accessibilityLabel={[p.name, p.poster ? "posted this" : null].filter(Boolean).join(", ")}
                >
                  <Text variant="bodyStrong">{p.name}</Text>
                  {p.poster ? (
                    <Text variant="small" tone="inkMuted">
                      Posted this
                    </Text>
                  ) : null}
                </View>
                {m.role === "poster" && !p.poster ? (
                  <Pressable
                    onPress={() => remove(p.userId, p.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${p.name}`}
                    style={({ pressed }) => ({
                      minHeight: MIN_TAP,
                      minWidth: MIN_TAP,
                      justifyContent: "center",
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text tone="danger" style={{ textDecorationLine: "underline" }}>
                      Remove
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </Card>
          {m.role === "poster" ? (
            <>
              <Text variant="small" tone="inkMuted">
                Remove someone and their spot opens back up in Discover.
              </Text>
              <Button label="Cancel this match" variant="destructiveOutline" onPress={cancel} loading={act.isPending} />
            </>
          ) : m.role === "in" ? (
            <Button label="Drop out" variant="destructiveOutline" onPress={drop} loading={act.isPending} disabled={m.started} />
          ) : null}
        </>
      ) : (
        <Text tone="inkMuted">{q.isError ? "Can't load the players. Drag down and try again." : "Loading players…"}</Text>
      )}
    </SheetBody>
  );
}
