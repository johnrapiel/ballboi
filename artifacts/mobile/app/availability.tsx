// When you can play (canvas W2_Availability; F7, F8, F11). One generic
// Monday to Sunday week, hourly from 6 AM to 9 PM: tap or drag across the
// hours you're usually free. No week picker and no "Copy last week". The
// grid powers Discover only ("Free when I'm free" and the player card's
// summary); league pairing doesn't use it.
//
// Accessibility (review finding 4): every cell is its own VoiceOver button,
// "Monday 6 PM, free" or "not free"; each hour's label toggles the whole row,
// the non-drag way to fill it. Dragging starts on the cells only, so the hour
// labels and the space around the grid still scroll to the evening rows.
// Save stays pinned at the bottom.

import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, PanResponder, Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProblemCard } from "@/components/discover/States";
import { Button, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscoverMe, useSaveAvailability } from "@/hooks/useDiscover";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import {
  DAY_LETTERS,
  DAY_NAMES,
  HOURS,
  cellAt,
  cellSpoken,
  hourShort,
  hourSpoken,
  hoursFreeLine,
  paintSlot,
  rowSlots,
  sameSlots,
  slotOf,
  toggleRow,
  toggleSlot,
} from "@/lib/discover";

const LABEL_W = 44;
const CELL_H = 44;
const GAP = 2;

export default function AvailabilityScreen() {
  const c = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const me = useDiscoverMe();
  const save = useSaveAvailability();

  const [slots, setSlots] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (me.data && !loaded) {
      setSlots(new Set(me.data.slots));
      setLoaded(true);
    }
  }, [me.data, loaded]);

  const saved = me.data?.slots ?? [];
  const dirty = loaded && !sameSlots(slots, saved);
  const [leaving, setLeaving] = useState(false);

  // Leaving with changes asks first (Wave 1 sheet rule, same words).
  usePreventRemove(dirty && !leaving, ({ data }) => {
    Alert.alert("Discard changes?", "The hours you marked won't be saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving, router]);

  async function onSave() {
    try {
      const after = await save.mutateAsync([...slots].sort((a, b) => a - b));
      AccessibilityInfo.announceForAccessibility(`Saved. ${hoursFreeLine(after.hoursFree)}.`);
      setLeaving(true);
    } catch (e) {
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    }
  }

  // ─── Drag to paint ──────────────────────────────────────────────────────
  const [gridW, setGridW] = useState(0);
  const cellW = gridW > 0 ? (gridW - LABEL_W - GAP * 7) / 7 : 0;
  const layout = useRef({ labelWidth: LABEL_W + GAP, cellWidth: 0, cellHeight: CELL_H, gap: GAP });
  layout.current.cellWidth = cellW;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const painting = useRef<{ on: boolean; last: number | null } | null>(null);
  // Where the grid sits on screen, so a touch's page position finds its cell.
  // Re-measured after layout and after each scroll; a paint never scrolls.
  const gridRef = useRef<React.ComponentRef<typeof View>>(null);
  const origin = useRef({ x: 0, y: 0 });
  const measure = () => gridRef.current?.measureInWindow((x: number, y: number) => (origin.current = { x, y }));
  const cellFor = (pageX: number, pageY: number) => cellAt(pageX - origin.current.x, pageY - origin.current.y, layout.current);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only touches that start on a cell paint; the hour labels scroll.
        onStartShouldSetPanResponder: (e) => e.nativeEvent.pageX - origin.current.x > LABEL_W + GAP,
        onMoveShouldSetPanResponder: () => painting.current !== null,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const cell = cellFor(e.nativeEvent.pageX, e.nativeEvent.pageY);
          if (!cell) return;
          const slot = slotOf(cell.day, cell.hour);
          const on = !slotsRef.current.has(slot);
          painting.current = { on, last: slot };
          setSlots((s) => paintSlot(s, slot, on));
        },
        onPanResponderMove: (e) => {
          if (!painting.current) return;
          const cell = cellFor(e.nativeEvent.pageX, e.nativeEvent.pageY);
          if (!cell) return;
          const slot = slotOf(cell.day, cell.hour);
          if (slot === painting.current.last) return;
          painting.current.last = slot;
          const on = painting.current.on;
          setSlots((s) => paintSlot(s, slot, on));
        },
        onPanResponderRelease: () => {
          painting.current = null;
        },
        onPanResponderTerminate: () => {
          painting.current = null;
        },
      }),
    [],
  );

  if (!me.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        {me.isError ? (
          <ProblemCard title="Can't load your times" body="Check your connection and try again." onRetry={() => void me.refetch()} retrying={me.isRefetching} />
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
      <ScrollView
        onScrollEndDrag={measure}
        onMomentumScrollEnd={measure}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: 120 + insets.bottom, gap: spacing.space4 }}
      >
        <View style={{ gap: spacing.space2 }}>
          <Text variant="brushL" accessibilityRole="header">
            When you can play
          </Text>
          <Text tone="inkMuted">Tap or drag the hours you're usually free in a week. Tap an hour to fill its whole row.</Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="bodyStrong">Monday to Sunday</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: c.ink }} importantForAccessibility="no" accessibilityElementsHidden />
            <Text variant="small" accessibilityLiveRegion="polite" accessibilityRole="text">
              {hoursFreeLine(slots.size)}
            </Text>
          </View>
        </View>

        <View accessibilityLabel="Hours you're free, Monday to Sunday" onLayout={(e: LayoutChangeEvent) => setGridW(e.nativeEvent.layout.width)}>
          {/* Day letters */}
          <View style={{ flexDirection: "row", gap: GAP, marginBottom: spacing.space1 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={{ width: LABEL_W }} />
            {DAY_LETTERS.map((d, i) => (
              <Text key={i} variant="label" tone="inkMuted" maxFontSizeMultiplier={1.3} style={{ width: cellW, textAlign: "center" }}>
                {d}
              </Text>
            ))}
          </View>
          <View ref={gridRef} onLayout={measure} {...pan.panHandlers} style={{ gap: GAP }}>
            {HOURS.map((h) => {
              const row = rowSlots(h);
              const allOn = row.every((s) => slots.has(s));
              return (
                <View key={h} style={{ flexDirection: "row", gap: GAP }}>
                  <Pressable
                    onPress={() => setSlots((s) => toggleRow(s, h))}
                    accessibilityRole="button"
                    accessibilityLabel={`${hourSpoken(h)}, every day`}
                    accessibilityState={{ selected: allOn }}
                    accessibilityHint={allOn ? "Marks this hour not free, Monday to Sunday" : "Marks this hour free, Monday to Sunday"}
                    style={({ pressed }) => ({
                      width: LABEL_W,
                      height: CELL_H,
                      alignItems: "flex-end",
                      justifyContent: "center",
                      paddingRight: 6,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text variant="small" tone="inkMuted" maxFontSizeMultiplier={1.3} style={{ textDecorationLine: "underline" }}>
                      {hourShort(h)}
                    </Text>
                  </Pressable>
                  {DAY_NAMES.map((_, d) => {
                    const slot = slotOf(d, h);
                    const on = slots.has(slot);
                    return (
                      <View
                        key={d}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={cellSpoken(d, h, on)}
                        accessibilityState={{ selected: on }}
                        onAccessibilityTap={() => setSlots((s) => toggleSlot(s, slot))}
                        style={{
                          width: cellW,
                          height: CELL_H,
                          borderRadius: radius.radiusSm + 2,
                          borderWidth: 1,
                          borderColor: on ? c.ink : c.hairlineStrong,
                          backgroundColor: on ? c.ink : c.linen,
                        }}
                      />
                    );
                  })}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

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
        <Button label="Save" onPress={() => void onSave()} loading={save.isPending} disabled={!dirty} accessibilityHint={dirty ? undefined : "Mark or clear an hour first"} />
      </View>
    </View>
  );
}
