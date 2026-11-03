import { useRouter } from "expo-router";
import React, { useState } from "react";
import { TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Text } from "@/components/ui";
import { radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { cleanCode } from "@/lib/leagueInvite";

// Join with an invite code (spec: Leagues, joining with a code; design:
// Leagues hierarchy, "invite sheet open"). Opens as a native sheet from the
// "Enter your invite code" row on the Leagues tab. Swipe down to dismiss.
// The code opens the same join screen an invite link does (C1), so typed
// codes and links behave the same way.

export default function JoinWithCodeSheet() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");

  function lookUp() {
    const cleaned = cleanCode(code);
    if (!cleaned) return;
    router.replace({ pathname: "/join/[code]", params: { code: cleaned } });
  }

  return (
    <View
      style={{
        backgroundColor: c.linen,
        paddingTop: spacing.space6,
        paddingHorizontal: spacing.space6,
        paddingBottom: insets.bottom + spacing.space4,
        gap: spacing.space4,
      }}
    >
      <View style={{ gap: spacing.space2 }}>
        <Text variant="titleItalic" accessibilityRole="header">
          Have an invite code?
        </Text>
        <Text tone="inkMuted">Enter the code your league organizer sent, or just open their link.</Text>
      </View>

      <View style={{ gap: spacing.space2, marginTop: spacing.space1 }}>
        <Text variant="label" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
          Invite code
        </Text>
        {/* Ticket-style well: sand fill, dashed control border (3:1). */}
        <View
          style={{
            minHeight: 64,
            justifyContent: "center",
            paddingHorizontal: spacing.space4,
            backgroundColor: c.sand,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: c.hairlineStrong,
            borderRadius: radius.radiusMd,
          }}
        >
          <TextInput
            value={code}
            onChangeText={setCode}
            accessibilityLabel="Invite code"
            placeholder="BEACON35"
            placeholderTextColor={c.inkMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={lookUp}
            style={[
              type.bodyStrong,
              {
                minHeight: 44,
                fontSize: 22,
                lineHeight: 28,
                letterSpacing: 5,
                fontVariant: ["lining-nums", "tabular-nums"],
                color: c.ink,
              },
            ]}
          />
        </View>
      </View>

      <Button label="Continue" onPress={lookUp} disabled={!cleanCode(code)} style={{ marginTop: spacing.space2 }} />
    </View>
  );
}
