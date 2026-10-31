import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useIsAdmin, useOpenReports } from "@/hooks/useModeration";

/**
 * Admin only: a row at the top of Messages that opens Moderation, with the
 * number of open reports. Nobody else ever sees it.
 */
export function ModerationRow() {
  const c = useColors();
  const router = useRouter();
  const { isAdmin } = useIsAdmin();
  const reports = useOpenReports(isAdmin);
  if (!isAdmin) return null;
  const open = reports.data?.length ?? 0;
  const sub = open === 0 ? "No open reports" : open === 1 ? "1 open report" : `${open} open reports`;
  return (
    <Pressable
      onPress={() => router.push("/moderation")}
      accessibilityRole="button"
      accessibilityLabel={`Moderation. ${sub}`}
      style={({ pressed }) => ({
        minHeight: 56,
        marginHorizontal: spacing.space4,
        marginBottom: spacing.space3,
        paddingHorizontal: spacing.space4,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        borderRadius: radius.radiusMd,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
        backgroundColor: c.linen,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <SymbolView name="checkmark.shield" size={20} tintColor={c.ink} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">Moderation</Text>
        <Text variant="small" tone="inkMuted">
          {sub}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
    </Pressable>
  );
}
