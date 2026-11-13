import { useRouter } from "expo-router";
import React, { useState } from "react";
import { TextInput, View } from "react-native";

import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { codeFromInput } from "@/lib/leagueInvite";

// Join with an invite code (spec: Leagues, joining with a code; approved
// Leagues: "Got an invite code?" opens this bottom sheet). The sheet rule:
// brush title, Close (X) or drag down to close, asks before discarding a code.
// The code opens the same join screen an invite link does (C1), so typed
// codes and links behave the same way. Pasting the copied link works too.

export default function JoinWithCodeSheet() {
  const c = useColors();
  const router = useRouter();
  const [code, setCode] = useState("");
  const sheet = useSheetClose(code.trim() !== "");

  function lookUp() {
    const cleaned = codeFromInput(code);
    if (!cleaned) return;
    sheet.finish(() => router.replace({ pathname: "/join/[code]", params: { code: cleaned } }));
  }

  return (
    <SheetBody title="Invite code" close={sheet.close}>
      <Text tone="inkMuted">Enter the code your league admin sent, or just open their link.</Text>

      <View
        style={{
          minHeight: 64,
          justifyContent: "center",
          paddingHorizontal: spacing.space4,
          backgroundColor: c.linen,
          borderWidth: 1,
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
              minHeight: MIN_TAP,
              fontSize: 22,
              lineHeight: 28,
              letterSpacing: 5,
              fontVariant: ["lining-nums", "tabular-nums"],
              color: c.ink,
            },
          ]}
        />
      </View>

      <Button label="Continue" onPress={lookUp} disabled={!codeFromInput(code)} />
    </SheetBody>
  );
}
