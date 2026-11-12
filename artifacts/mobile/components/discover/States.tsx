// Discover's drawn states (canvas W2_DiscoverLoading, W2_DiscoverError,
// W2_DiscoverEmpty, W2_DiscoverHidden, and the "Set times" prompt): every
// one has a way forward, so nothing dead-ends.

import { Icon, type IconName } from "@/components/Icon";
import React, { useEffect } from "react";
import { AccessibilityInfo, View } from "react-native";

import { Roundel } from "@/components/Roundel";
import { Button, Card, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * Sand placeholder rows while players load, as drawn. They hold still (no
 * shimmer), so there's nothing for Reduce Motion to stop; the count line
 * above says "Finding players…" for VoiceOver.
 */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const c = useColors();
  const bar = (width: number | `${number}%`, height: number, pill = false) => (
    <View style={{ width, height, borderRadius: pill ? radius.radiusPill : radius.radiusSm, backgroundColor: c.sand }} />
  );
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {Array.from({ length: rows }, (_, i) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              gap: spacing.space3,
              padding: spacing.space4,
              borderBottomWidth: i === rows - 1 ? 0 : 1,
              borderBottomColor: c.hairline,
            }}
          >
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.sand }} />
            <View style={{ flex: 1, gap: spacing.space2 }}>
              {bar(["48%", "62%", "40%", "55%"][i % 4] as `${number}%`, 16)}
              {bar(40, 22, true)}
              {bar("70%", 13)}
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

/** A card with an icon, a line or two, and an action: "Set times", "You're hidden". */
export function NoteCard({ symbol, title, body, action }: { symbol: IconName; title?: string; body: string; action?: React.ReactNode }) {
  const c = useColors();
  return (
    <Card style={{ flexDirection: "row", gap: spacing.space3, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={symbol} size={20} tintColor={c.ink} />
      </View>
      <View style={{ flex: 1, gap: spacing.space1 }}>
        {title ? <Text variant="bodyStrong">{title}</Text> : null}
        <Text variant={title ? "small" : "body"} tone={title ? "inkMuted" : "ink"}>
          {body}
        </Text>
        {action}
      </View>
    </Card>
  );
}

/** "Can't load players right now" with Try again. Says it out loud for VoiceOver. */
export function ProblemCard({ title, body, onRetry, retrying }: { title: string; body: string; onRetry: () => void; retrying?: boolean }) {
  const c = useColors();
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${title}. ${body}`);
  }, [title, body]);
  return (
    <Card style={{ alignItems: "center", gap: spacing.space2 }}>
      <View
        style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.sand, alignItems: "center", justifyContent: "center" }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Icon name="wifi.slash" size={22} tintColor={c.ink} />
      </View>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${title}. ${body}`}
        style={{ gap: spacing.space2, alignItems: "center" }}
      >
        <Text variant="title" style={{ textAlign: "center" }}>
          {title}
        </Text>
        <Text tone="inkMuted" style={{ textAlign: "center" }}>
          {body}
        </Text>
      </View>
      <Button
        label="Try again"
        variant="secondary"
        onPress={onRetry}
        loading={retrying}
        style={{ alignSelf: "stretch", marginTop: spacing.space2 }}
      />
    </Card>
  );
}

/** The roundel, a title, a line, and the ways forward. */
export function EmptyBlock({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <View style={{ alignItems: "center", gap: spacing.space2, paddingTop: spacing.space4, paddingHorizontal: spacing.space2 }}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Roundel size={120} />
      </View>
      <View accessible accessibilityLabel={`${title}. ${body}`} style={{ gap: spacing.space2, alignItems: "center" }}>
        <Text variant="title" accessibilityRole="header" style={{ textAlign: "center", marginTop: spacing.space2 }}>
          {title}
        </Text>
        <Text tone="inkMuted" style={{ textAlign: "center" }}>
          {body}
        </Text>
      </View>
      <View style={{ alignSelf: "stretch", gap: spacing.space2, marginTop: spacing.space2 }}>{children}</View>
    </View>
  );
}
