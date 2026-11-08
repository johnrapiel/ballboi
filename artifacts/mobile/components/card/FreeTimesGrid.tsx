import React from "react";
import { View } from "react-native";

import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { DAY_LETTERS, HOURS, hourShort, slotOf } from "@/lib/discover";

// The week's hour grid, read only (canvas W2_FreeTimesSheet): Monday to
// Sunday across, 6 AM to 9 PM down, free hours filled in ink. VoiceOver reads
// it as one picture with the summary in words.

export function FreeTimesGrid({ slots, spoken }: { slots: readonly number[]; spoken: string }) {
  const c = useColors();
  const on = new Set(slots);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={spoken} style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", gap: 2 }}>
        <View style={{ width: 36 }} />
        {DAY_LETTERS.map((d, i) => (
          <Text key={i} variant="small" tone="inkMuted" maxFontSizeMultiplier={1.4} style={{ flex: 1, textAlign: "center", fontFamily: "DMSans_600SemiBold" }}>
            {d}
          </Text>
        ))}
      </View>
      {HOURS.map((h) => (
        <View key={h} style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
          <Text variant="label" tone="inkMuted" maxFontSizeMultiplier={1.4} style={{ width: 36, textAlign: "right", paddingRight: 6 }}>
            {hourShort(h)}
          </Text>
          {DAY_LETTERS.map((_, d) => {
            const free = on.has(slotOf(d, h));
            return (
              <View
                key={d}
                style={{
                  flex: 1,
                  height: 26,
                  borderRadius: 5,
                  borderWidth: 1,
                  borderColor: free ? c.ink : c.hairlineStrong,
                  backgroundColor: free ? c.ink : c.linen,
                }}
              />
            );
          })}
        </View>
      ))}
      <View style={{ height: spacing.space1 }} />
    </View>
  );
}
