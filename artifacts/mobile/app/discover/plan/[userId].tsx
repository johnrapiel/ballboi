// Add a match card (F2; brief item 27): day, time, court and Singles or
// Practice hit, then Send. It shows in the chat as "Add this match?" for the
// other player. A time that has passed says so and stays on the form. A
// bottom sheet by the sheet rule.

import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, View, useColorScheme } from "react-native";

import { ChipRow, ChoiceChip } from "@/components/discover/Controls";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { courtPick, usePickedCourt } from "@/hooks/useCourts";
import { useSendMatchPlan } from "@/hooks/useDiscoverMatchPlans";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { defaultPlanStart, planWhen } from "@/lib/discover";

export default function AddMatchCardSheet() {
  const c = useColors();
  const scheme = useColorScheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ userId: string; name?: string }>();
  const userId = Number(params.userId);
  const them = (params.name ?? "them").split(" ")[0];
  const [startsAt, setStartsAt] = useState(() => defaultPlanStart(new Date()));
  const [kind, setKind] = useState<"singles" | "practice">("singles");
  const [error, setError] = useState<string | null>(null);
  const court = usePickedCourt();
  const send = useSendMatchPlan();
  const [touched, setTouched] = useState(false);
  const sheet = useSheetClose(touched && !send.isPending);

  // A fresh card starts with no court picked.
  useEffect(() => {
    courtPick.clear();
  }, []);

  const change = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) return;
    setStartsAt(d);
    setTouched(true);
    setError(null);
  };

  async function submit() {
    setError(null);
    try {
      await send.mutateAsync({
        userId,
        startsAt: startsAt.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        courtId: court?.courtId ?? null,
        kind,
      });
      AccessibilityInfo.announceForAccessibility(`Match card sent. Waiting for ${them}.`);
      sheet.finish();
    } catch (e) {
      const message = isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Couldn't send the match card. Try again.";
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }

  return (
    <SheetBody title="Add a match" close={sheet.close}>
      <Text tone="inkMuted">{`${them} gets "Add this match?" in your chat. Once they're in, it goes on both your schedules.`}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.space2 }}>
        <Text variant="bodyStrong">Day and time</Text>
        <View style={{ flexDirection: "row", gap: spacing.space2 }}>
          <DateTimePicker
            value={startsAt}
            mode="date"
            display="compact"
            minimumDate={new Date()}
            maximumDate={new Date(Date.now() + 60 * 86_400_000)}
            themeVariant={scheme === "dark" ? "dark" : "light"}
            accentColor={c.ink}
            accessibilityLabel="Day"
            onChange={change}
          />
          <DateTimePicker
            value={startsAt}
            mode="time"
            display="compact"
            minuteInterval={15}
            themeVariant={scheme === "dark" ? "dark" : "light"}
            accentColor={c.ink}
            accessibilityLabel="Time"
            onChange={change}
          />
        </View>
      </View>
      <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite">
        {planWhen(startsAt.toISOString())}
      </Text>

      <SettingsSection>
        <SettingsRow
          title="Court"
          value={court ? court.name : "Not set"}
          onPress={() => {
            setTouched(true);
            router.push({ pathname: "/courts", params: { mode: "match" } });
          }}
          accessibilityHint="Pick from the court directory, or leave it not set"
          last
        />
      </SettingsSection>

      <View style={{ gap: spacing.space2 }}>
        <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
          Play
        </Text>
        <ChipRow label="Play">
          <ChoiceChip label="Singles" selected={kind === "singles"} onPress={() => setKind("singles")} />
          <ChoiceChip label="Practice hit" selected={kind === "practice"} onPress={() => setKind("practice")} />
        </ChipRow>
      </View>

      {error ? (
        <Text variant="small" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label="Send" onPress={() => void submit()} loading={send.isPending} accessibilityHint={`Sends the match card to ${them}`} />
    </SheetBody>
  );
}
