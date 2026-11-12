// When you can play (John, Nov 9; spec decision 156, replacing F7's hour
// grid). One row per day, Monday to Sunday. Each row has pills: Morning 7 to
// 11, Afternoon 12 to 4, Evening 5 to 9, and Custom, any number per day.
// Custom opens a text field on that day's row ("6-8pm, 9 to 10 PM"); each
// time it reads becomes its own pill, and tapping one edits or removes it.
// Anything it can't read is named in words, everything typed stays, and
// Save stays off until it's fixed.
//
// One way in for each place: Edit profile's Free times row, the Free times
// sheet's Edit, Discover's "Set times" (F11) and Filters' "Set times".
// Powers Discover only: the card's summary and "Free when I'm free".
//
// Rules: page title in the 50% serif style, back at the top left, Save pinned
// at the bottom, "Discard changes?" before leaving with changes. Selected
// pills are filled ink with on-ink text and no check (Nov 7 chip rule), read
// as "selected". Pills wrap onto more lines at the largest text sizes.

import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Alert, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { freeSummary } from "@workspace/free-times";

import { useActionSheet } from "@/components/ActionSheet";
import { DayRow } from "@/components/card/FreeTimesDayRow";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ProblemCard } from "@/components/discover/States";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { useDiscoverMe, useSaveAvailability } from "@/hooks/useDiscover";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import {
  DAY_NAMES,
  applyCustom,
  editText,
  freeTimesLine,
  rangeText,
  removeTime,
  sameTimes,
  saveHint,
  toggleBlock,
  withFields,
  type CustomField,
  type FreeRange,
} from "@/lib/freeTimes";

type Fields = Record<number, CustomField>;

export default function AvailabilityScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = useDiscoverMe();
  const save = useSaveAvailability();

  const [ranges, setRanges] = useState<FreeRange[]>([]);
  const [fields, setFields] = useState<Fields>({});
  // Days whose field has been left or submitted: only then are problems shown,
  // so half-typed text ("6-") isn't called unreadable mid-word.
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const sheet = useActionSheet();
  useEffect(() => {
    if (me.data && !loaded) {
      setRanges(me.data.freeTimes);
      setLoaded(true);
    }
  }, [me.data, loaded]);

  const saved = me.data?.freeTimes ?? [];
  const draft = useMemo(() => withFields(ranges, fields), [ranges, fields]);
  const hasProblems = Object.keys(draft.problems).length > 0;
  const changed = loaded && !sameTimes(draft.ranges, saved);
  const dirty = changed || hasProblems;
  const guard = useDiscardGuard(dirty, { title: "Discard changes?", message: "The times you picked won't be saved." });

  const openField = (day: number, editing: FreeRange | null) => {
    setFields((f) => ({ ...f, [day]: { text: editing ? editText(editing) : "", editing } }));
    setChecked((x) => ({ ...x, [day]: false }));
  };
  const closeField = (day: number) => {
    setFields((f) => {
      const next = { ...f };
      delete next[day];
      return next;
    });
    setChecked((x) => ({ ...x, [day]: false }));
  };
  const typeIn = (day: number, text: string) => setFields((f) => ({ ...f, [day]: { ...f[day], text } }));

  /** Add (or Done): turns what's typed into pills, or says what couldn't be read. */
  const addField = (day: number) => {
    const field = fields[day];
    if (!field) return;
    if (!field.text.trim()) {
      // Nothing typed: closing an edit keeps the time it was editing.
      closeField(day);
      return;
    }
    const r = applyCustom(ranges, day, field);
    if (r.problems.length) {
      setChecked((x) => ({ ...x, [day]: true }));
      AccessibilityInfo.announceForAccessibility(r.problems.join(" "));
      return;
    }
    setRanges(r.ranges);
    closeField(day);
    const added = r.ranges.filter((x) => x.day === day && !ranges.some((y) => y.day === day && y.start === x.start && y.end === x.end));
    if (added.length) AccessibilityInfo.announceForAccessibility(`Added ${added.map(rangeText).join(", ")} on ${DAY_NAMES[day]}`);
  };

  // A time you typed: Edit or Remove, in a bottom sheet (decision 186).
  const customMenu = (r: FreeRange) => {
    const when = `${rangeText(r)}, ${DAY_NAMES[r.day]}`;
    sheet.show({
      title: when,
      rows: [
        { label: "Edit", icon: "pencil", onPress: () => openField(r.day, r) },
        {
          label: "Remove",
          icon: "trash",
          destructive: true,
          confirm: { title: `Remove ${when}?`, action: "Remove" },
          onPress: () => {
            setRanges((x) => removeTime(x, r));
            AccessibilityInfo.announceForAccessibility(`Removed ${rangeText(r)} on ${DAY_NAMES[r.day]}`);
          },
        },
      ],
    });
  };

  async function onSave() {
    if (hasProblems) return;
    try {
      const after = await save.mutateAsync(draft.ranges);
      AccessibilityInfo.announceForAccessibility(`Saved. ${freeTimesLine(after.freeSummary ?? freeSummary(after.freeTimes), true)}`);
      guard.finish();
    } catch (e) {
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    }
  }

  if (!me.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        {me.isError ? (
          <ProblemCard
            title="Can't load your times"
            body="Check your connection and try again."
            onRetry={() => void me.refetch()}
            retrying={me.isRefetching}
          />
        ) : (
          <Text tone="inkMuted" accessibilityRole="progressbar">
            Loading your times…
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      {sheet.element}
      <KeyboardAwareScrollViewCompat
        bottomOffset={spacing.space6}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: 120 + insets.bottom, gap: spacing.space4 }}
      >
        <View style={{ gap: spacing.space2 }}>
          <Text variant="headingL" accessibilityRole="header">
            When you can play
          </Text>
          <Text tone="inkMuted">Pick the times you're usually free each week. Players near you see a short summary on your card.</Text>
        </View>

        <View>
          {DAY_NAMES.map((name, day) => (
            <DayRow
              key={name}
              day={day}
              ranges={ranges}
              field={fields[day] ?? null}
              problems={checked[day] ? (draft.problems[day] ?? []) : []}
              last={day === 6}
              onToggle={(b) => setRanges((x) => toggleBlock(x, day, b))}
              onCustom={() => openField(day, null)}
              onCustomPill={customMenu}
              onType={(t) => typeIn(day, t)}
              onAdd={() => addField(day)}
              onLeave={() => setChecked((x) => ({ ...x, [day]: true }))}
              onCancel={() => closeField(day)}
            />
          ))}
        </View>
      </KeyboardAwareScrollViewCompat>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space3,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.paper,
        }}
      >
        <Button
          label="Save"
          onPress={() => void onSave()}
          loading={save.isPending}
          disabled={!changed || hasProblems}
          accessibilityHint={saveHint(draft.problems, changed)}
        />
      </View>
    </View>
  );
}
