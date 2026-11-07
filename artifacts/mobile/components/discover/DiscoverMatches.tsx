// Matches set up in chat (F2; brief item 28), on Home and My matches: the
// day, who with, where, and a tap opens your chat with them, where the card
// lives. Shows nothing when there are none, so the screens around it are
// unchanged for players who don't use Discover.

import { useRouter } from "expo-router";
import { Icon } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";

import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useUpcomingMatchPlans } from "@/hooks/useDiscoverMatchPlans";
import { planDetail, planWhen } from "@/lib/discover";

export function DiscoverMatchesSection() {
  const c = useColors();
  const router = useRouter();
  const q = useUpcomingMatchPlans();
  const matches = q.data?.matches ?? [];
  if (!matches.length) return null;
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
        Set up in chat
      </Text>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {matches.map((m, i) => (
          <Pressable
            key={m.id}
            onPress={() =>
              m.otherUserId
                ? router.push({ pathname: "/conversation/[id]", params: { id: "new", userId: String(m.otherUserId), name: m.otherName } })
                : undefined
            }
            accessibilityRole="button"
            accessibilityLabel={`${planWhen(m.startsAt)}, with ${m.otherName}, ${planDetail(m)}`}
            accessibilityHint={`Opens your chat with ${m.otherName}`}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.space3,
              minHeight: 56,
              paddingHorizontal: spacing.space4,
              paddingVertical: spacing.space3,
              borderBottomWidth: i === matches.length - 1 ? 0 : 1,
              borderBottomColor: c.hairline,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{`${planWhen(m.startsAt)} · with ${m.otherName}`}</Text>
              <Text variant="small" tone="inkMuted">
                {planDetail(m)}
              </Text>
            </View>
            <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
