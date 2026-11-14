// Players in a filled open match (canvas W2_MembersSheet, W2_RemovePlayer;
// brief items 42 to 44). Everyone sees who's in. The poster can Remove a
// player (their spot reopens; they only hear "This match filled up") or
// cancel the match. A joiner can drop out. A bottom sheet by the sheet rule.
// Every other player's row has Report (Wave 2 finding 62), so a player who
// hasn't sent a message can still be reported; the poster also sees Remove.
// Your own row reads "You" with your photo, or your real initials.

import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { AccessibilityInfo, Alert, Pressable, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { DangerLink } from "@/components/DangerLink";
import { SheetBody } from "@/components/Sheet";
import { Card, Text, TextLink } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useOpenMatch, useOpenMatchAction } from "@/hooks/useDiscoverOpenMatches";
import { useReportBlock } from "@/hooks/useReportBlock";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { firstName } from "@/lib/discover";

export default function PlayersSheet() {
  const c = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const q = useOpenMatch(id);
  const act = useOpenMatchAction(id);
  const report = useReportBlock();
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
                  // The links wrap under the name when they don't fit beside it (largest Dynamic Type).
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  columnGap: spacing.space3,
                  padding: spacing.space3,
                  minHeight: 56,
                  borderBottomWidth: i === m.players.length - 1 ? 0 : 1,
                  borderBottomColor: c.hairline,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.space3,
                    flexGrow: 1,
                    flexShrink: 1,
                    flexBasis: 160,
                  }}
                >
                  {/* Your row reads "You" but shows your photo, or your real initials (finding 62). */}
                  <Avatar name={p.fullName ?? p.name} uri={p.avatarUrl} size={36} />
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
                </View>
                {!p.me && p.userId > 0 ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.space4,
                      marginLeft: "auto",
                    }}
                  >
                    {/* Decision 201: a quiet ink link; reporting doesn't change the match. */}
                    <RowLink
                      label="Report"
                      accessibilityLabel={`Report ${p.name}`}
                      onPress={() =>
                        report.open({
                          id: null,
                          userId: p.userId,
                          name: p.name,
                        })
                      }
                    />
                    {m.role === "poster" ? (
                      <RowLink label="Remove" danger accessibilityLabel={`Remove ${p.name}`} onPress={() => remove(p.userId, p.name)} />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
          {m.role === "poster" ? (
            <>
              <Text variant="small" tone="inkMuted">
                Remove someone and their spot opens back up in Discover.
              </Text>
              {/* Decision 184: quiet red text, still confirmed by the alert. */}
              <DangerLink label="Cancel match" icon="xmark.circle" onPress={cancel} busy={act.isPending} />
            </>
          ) : m.role === "in" ? (
            <DangerLink label="Drop out" icon="door.leave" onPress={drop} busy={act.isPending} disabled={m.started} />
          ) : null}
        </>
      ) : (
        <Text tone="inkMuted">{q.isError ? "Can't load the players. Drag down and try again." : "Loading players…"}</Text>
      )}
    </SheetBody>
  );
}

/** A text link at the end of a player row, padded to a 44pt target (decision 192). */
function RowLink({
  label,
  accessibilityLabel,
  onPress,
  danger = false,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {danger ? (
        <Text tone="danger" style={{ textDecorationLine: "underline" }}>
          {label}
        </Text>
      ) : (
        <TextLink onPress={onPress} accessible={false}>
          {label}
        </TextLink>
      )}
    </Pressable>
  );
}
