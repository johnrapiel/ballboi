import { Icon, type IconName } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";

import { Card, Pill, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { leagueTagLabel, type DiscoverLeagueCard, type LeagueTag } from "@/lib/discover";

const TAG_SYMBOL: Record<LeagueTag, IconName> = {
  outside_level: "arrow.up.arrow.down",
  full: "person.3.fill",
  started: "calendar.badge.clock",
};

/** "Outside your level", "Full", "Season started": an outline tag with its icon and words. */
export function LeagueTagPill({ tag }: { tag: LeagueTag }) {
  const c = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space1,
        minHeight: 26,
        paddingHorizontal: 10,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
        alignSelf: "flex-start",
      }}
    >
      <Icon name={TAG_SYMBOL[tag]} size={12} tintColor={c.ink} />
      <Text variant="pill">{leagueTagLabel(tag)}</Text>
    </View>
  );
}

/**
 * An Open league in Discover (canvas W2_DiscoverLeagues): name with its tags,
 * "~6 mi · Flex · Singles · Level 3.0 to 4.0", then the start and spots, or
 * "Full · Waitlist for next season". Read as one button.
 */
export function LeagueCard({ league, onPress }: { league: DiscoverLeagueCard; onPress: () => void }) {
  const c = useColors();
  const asked = league.myRequest?.status === "pending";
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={league.spoken} accessibilityHint="Opens the league">
      {({ pressed }) => (
        <Card style={{ gap: spacing.space2, paddingRight: spacing.space8, opacity: pressed ? 0.75 : 1 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
            <Text variant="title" style={{ flexShrink: 1 }}>
              {league.name}
            </Text>
            {league.tags.map((t) => (
              <LeagueTagPill key={t} tag={t} />
            ))}
            {asked ? <Pill label={league.myRequest?.kind === "waitlist" ? "On the waitlist" : "Requested"} /> : null}
          </View>
          <Text variant="small" tone="inkMuted">
            {league.detail}
          </Text>
          <Text variant="small" tone={league.joining === "waitlist" ? "inkMuted" : "ink"}>
            {league.status}
          </Text>
          <View style={{ position: "absolute", right: spacing.space4, top: spacing.space4 }} pointerEvents="none">
            <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
          </View>
        </Card>
      )}
    </Pressable>
  );
}
