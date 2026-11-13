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
// brush title, no Cancel, drag down to close, asks before discarding a code.
// The code opens the same join screen an invite link does (C1), so typed
// codes and links behave the same way. Pasting the copied link works too
// (#221): `codeFromInput` takes the code out of a ballboi.tennis/join link.

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
      <Text tone="inkMuted">Enter the code or paste the link your league admin sent.</Text>

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
          placeholder="Code or link"
          placeholderTextColor={c.inkMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={lookUp}
          // Empty, the field shows a plain placeholder in regular ink-muted
          // text, so it can't pass for a code someone already typed (Wave 2
          // finding 48). The spaced-out code look is for what you type.
          style={[
            code === "" ? type.body : type.bodyStrong,
            code === ""
              ? { minHeight: MIN_TAP, color: c.ink }
              : {
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
