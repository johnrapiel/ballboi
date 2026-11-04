import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React from "react";
import { View, useColorScheme } from "react-native";

import { ChoiceGroup } from "@/components/Choice";
import { Toggle } from "@/components/Toggle";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// A league's weekly match day and time (PR 4), for clubs that play at a set
// time. Off means players pick a time for each match within its week. Used in
// New league and in Manage's Match time sheet. Native iOS time picker.

const DAYS = [
  { value: 1, label: "Mon", accessibilityLabel: "Monday" },
  { value: 2, label: "Tue", accessibilityLabel: "Tuesday" },
  { value: 3, label: "Wed", accessibilityLabel: "Wednesday" },
  { value: 4, label: "Thu", accessibilityLabel: "Thursday" },
  { value: 5, label: "Fri", accessibilityLabel: "Friday" },
  { value: 6, label: "Sat", accessibilityLabel: "Saturday" },
  { value: 0, label: "Sun", accessibilityLabel: "Sunday" },
];

/** "18:30" for the API, from a picked time. */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A Date at `HH:MM` today, for the time picker; 6:30 PM when unset. */
export function timeFromHHMM(v: string | null | undefined): Date {
  const [h, m] = (v ?? "18:30").split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

export function MatchTimeFields({
  enabled,
  onEnabledChange,
  day,
  onDayChange,
  time,
  onTimeChange,
}: {
  enabled: boolean;
  onEnabledChange: (on: boolean) => void;
  day: number;
  onDayChange: (day: number) => void;
  time: Date;
  onTimeChange: (time: Date) => void;
}) {
  const c = useColors();
  const scheme = useColorScheme();
  return (
    <View style={{ gap: spacing.space4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Weekly match time</Text>
          <Text variant="small" tone="inkMuted">
            {enabled ? "Every match each week gets this day and time." : "Off: players pick a time for each match that week."}
          </Text>
        </View>
        <Toggle value={enabled} onValueChange={onEnabledChange} accessibilityLabel="Weekly match time" />
      </View>
      {enabled ? (
        <>
          <ChoiceGroup<number> label="Day" value={day} onChange={onDayChange} options={DAYS} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.space3 }}>
            <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
              Time
            </Text>
            <DateTimePicker
              value={time}
              mode="time"
              display="compact"
              minuteInterval={5}
              themeVariant={scheme === "dark" ? "dark" : "light"}
              accentColor={c.court}
              accessibilityLabel="Match time"
              onChange={(_: DateTimePickerEvent, d?: Date) => {
                if (d) onTimeChange(d);
              }}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
