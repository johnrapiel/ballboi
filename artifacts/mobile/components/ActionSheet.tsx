// The one menu (Wave 2 finding 35, decision 186): menus and pickers open in a
// bottom sheet. Native alerts are only for confirming destructive actions
// (delete, remove, leave, ban, discard) and for errors.
//
// Every menu:
// - slides up from the bottom and hugs its content, scrolling only when it's
//   taller than the screen (very large text, a long player list),
// - shows the grabber (decision 181). Swipe down or tap the dimmed backdrop
//   to close it. No Cancel row. The VoiceOver escape gesture closes it too,
// - has an optional header: a title, a short message, and the people it's
//   about with their photo or initials (a match shows both players),
// - lists its actions as rows at least 52pt tall, each with a brush icon,
// - shows destructive rows in `danger`. They close the sheet and then ask
//   with a native alert before anything happens,
// - can push a second step in the same sheet (Swap Maya Chen with: a player
//   list), with Back at the top left.
//
// Reduce Motion: the sheet fades in and out instead of sliding.
//
// Use it with `useActionSheet()`: render `sheet.element` once in the screen,
// then call `sheet.show({...})`.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/Icon";
import { Grabber } from "@/components/Sheet";
import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/** Someone the menu is about, shown with their photo or initials. */
export interface SheetPerson {
  name: string;
  /** Raw stored path, full URL or null: `Avatar` sorts it out. */
  photo?: string | null;
  /** A short line under the name, like their level. */
  detail?: string | null;
}

export interface SheetRow {
  label: string;
  /** A second line in muted text, like a player's level. */
  detail?: string | null;
  /** A brush icon at the start of the row. Rows with `person` show their photo instead. */
  icon?: IconName;
  /** A player row: their photo or initials in place of the icon. */
  person?: SheetPerson;
  /** Red text and icon. Must confirm with a native alert: pass `confirm`, or have `onPress` show one. */
  destructive?: boolean;
  /** The native alert a destructive row asks first. `action` is its red button. */
  confirm?: { title: string; message?: string; action: string };
  /** Runs once the sheet has closed (so an alert or a pushed screen can show). */
  onPress?: () => void;
  /** A second step: pushed inside the same sheet, with Back at the top left. */
  next?: SheetPage;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export interface SheetPage {
  /** Plain words. A title with someone's name in it sets `titleHasName`. */
  title?: string;
  /** Names are always full ink (design system, Type): the title shows as `title`, not the 50% heading. */
  titleHasName?: boolean;
  message?: string;
  /** Who it's about. Two people show as "A vs. B" (a match). */
  people?: SheetPerson[];
  rows: SheetRow[];
  /** Shown when `rows` is empty, like "No one else to swap with." */
  empty?: string;
}

export interface ActionSheetHandle {
  /** Opens the sheet on this page (replacing anything already open). */
  show: (page: SheetPage) => void;
  close: () => void;
  /** Render once, anywhere in the screen. */
  element: React.ReactElement;
}

/** A sheet you open from code, the way ActionSheetIOS worked. */
export function useActionSheet(): ActionSheetHandle {
  const [stack, setStack] = useState<SheetPage[]>([]);
  const [open, setOpen] = useState(false);
  const show = useCallback((page: SheetPage) => {
    setStack([page]);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const element = (
    <ActionSheet
      open={open}
      stack={stack}
      onPush={(p) => setStack((s) => [...s, p])}
      onBack={() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
      onClose={() => setOpen(false)}
      onClosed={() => setStack([])}
    />
  );
  return { show, close, element };
}

// How far, or how fast, a drag down has to go to close the sheet.
const CLOSE_DISTANCE = 80;
const CLOSE_VELOCITY = 0.8;
const DURATION = 250;

// The dimmed backdrop behind the sheet. It's the system's dimming, not a
// design token: the same black at 35% the age check's date sheet uses, so the
// screen behind reads as inactive in Day and Night alike.
const BACKDROP = "rgba(0, 0, 0, 0.35)";

function ActionSheet({
  open,
  stack,
  onPush,
  onBack,
  onClose,
  onClosed,
}: {
  open: boolean;
  stack: SheetPage[];
  onPush: (p: SheetPage) => void;
  onBack: () => void;
  onClose: () => void;
  onClosed: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Mounted while open or animating out.
  const [mounted, setMounted] = useState(false);
  const shown = useRef(new Animated.Value(0)).current; // 0 hidden, 1 shown
  const drag = useRef(new Animated.Value(0)).current; // finger offset, down is positive
  const [sheetH, setSheetH] = useState(height);
  const scrollY = useRef(0);
  /** What a row asked to do, run once the sheet is fully gone. */
  const pending = useRef<(() => void) | null>(null);
  const headerRef = useRef<React.ComponentRef<typeof View>>(null);

  const page = stack[stack.length - 1];
  const canGoBack = stack.length > 1;

  useEffect(() => {
    if (open) {
      // Start below the screen until the new content is measured.
      if (!mounted) setSheetH(height);
      setMounted(true);
      drag.setValue(0);
      Animated.timing(shown, {
        toValue: 1,
        duration: DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(shown, {
        toValue: 0,
        duration: reduceMotion ? DURATION * 0.8 : DURATION * 0.85,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Runs what the row asked for once the Modal has gone, so an alert or a
  // pushed screen isn't presented on top of a closing modal. iOS reports it
  // with onDismiss; the timer is a backstop.
  const runPending = useCallback(() => {
    const go = pending.current;
    pending.current = null;
    onClosed();
    go?.();
  }, [onClosed]);
  useEffect(() => {
    if (mounted || Platform.OS === "ios") return;
    runPending();
  }, [mounted, runPending]);
  useEffect(() => {
    if (mounted) return;
    const t = setTimeout(() => {
      if (pending.current) runPending();
    }, 400);
    return () => clearTimeout(t);
  }, [mounted, runPending]);

  // A new step: VoiceOver moves to its header.
  useEffect(() => {
    if (!open || !headerRef.current) return;
    const node = findNodeHandle(headerRef.current);
    if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 50);
  }, [open, mounted, stack.length]);

  const pick = (row: SheetRow) => {
    if (row.next) {
      scrollY.current = 0;
      onPush(row.next);
      return;
    }
    const go = row.onPress;
    if (row.destructive && row.confirm && go) {
      const { title, message, action } = row.confirm;
      pending.current = () =>
        Alert.alert(title, message, [
          { text: "Cancel", style: "cancel" },
          { text: action, style: "destructive", onPress: go },
        ]);
    } else {
      pending.current = go ?? null;
    }
    onClose();
  };

  // Swipe down to close: from the grabber and header any time, and from the
  // list when it's scrolled to the top.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 2 && scrollY.current <= 0,
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > CLOSE_DISTANCE || g.vy > CLOSE_VELOCITY) {
            onClose();
          } else {
            Animated.spring(drag, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
            }).start();
          }
        },
        onPanResponderTerminate: () =>
          Animated.spring(drag, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start(),
      }),
    [drag, onClose],
  );

  const maxHeight = height - insets.top - spacing.space6;
  const slide = reduceMotion
    ? drag
    : Animated.add(
        shown.interpolate({
          inputRange: [0, 1],
          outputRange: [sheetH + insets.bottom, 0],
        }),
        drag,
      );

  return (
    // Stays rendered so iOS can report onDismiss when it closes.
    <Modal
      visible={mounted && !!page}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      {page ? (
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          {/* Tapping outside closes it, like a native sheet. VoiceOver closes it with the escape gesture. */}
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              opacity: shown,
            }}
          >
            <Pressable style={{ flex: 1, backgroundColor: BACKDROP }} onPress={onClose} accessible={false} importantForAccessibility="no" />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            onAccessibilityEscape={canGoBack ? onBack : onClose}
            onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
            {...pan.panHandlers}
            style={{
              maxHeight,
              backgroundColor: c.linen,
              borderTopLeftRadius: radius.radiusLg,
              borderTopRightRadius: radius.radiusLg,
              borderColor: c.hairline,
              borderWidth: 1,
              borderBottomWidth: 0,
              opacity: reduceMotion ? shown : 1,
              transform: [{ translateY: slide }],
            }}
          >
            <Grabber />
            <ScrollView
              style={{ flexGrow: 0 }}
              alwaysBounceVertical={false}
              scrollEventThrottle={16}
              onScroll={(e) => {
                scrollY.current = e.nativeEvent.contentOffset.y;
              }}
              contentContainerStyle={{
                paddingBottom: insets.bottom + spacing.space3,
              }}
            >
              {canGoBack ? <BackRow onPress={onBack} /> : null}
              <Header page={page} headerRef={headerRef} />
              <View>
                {page.rows.length === 0 && page.empty ? (
                  <Text
                    tone="inkMuted"
                    style={{
                      paddingHorizontal: spacing.space4,
                      paddingVertical: spacing.space3,
                    }}
                  >
                    {page.empty}
                  </Text>
                ) : null}
                {page.rows.map((row, i) => (
                  <Row key={`${row.label}-${i}`} row={row} first={i === 0} onPress={() => pick(row)} />
                ))}
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

function BackRow({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={spacing.space1}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space1,
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        marginTop: spacing.space1,
        paddingHorizontal: spacing.space3,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="arrow.left" size={20} tintColor={c.ink} />
      <Text variant="bodyStrong">Back</Text>
    </Pressable>
  );
}

function Header({ page, headerRef }: { page: SheetPage; headerRef: React.RefObject<React.ComponentRef<typeof View> | null> }) {
  const people = page.people ?? [];
  if (!page.title && !page.message && people.length === 0) {
    return <View ref={headerRef} style={{ height: spacing.space3 }} />;
  }
  const spoken = [page.title, people.map((p) => p.name).join(" vs. "), page.message].filter(Boolean).join(". ");
  return (
    <View
      ref={headerRef}
      accessible
      accessibilityRole="header"
      accessibilityLabel={spoken}
      style={{
        paddingHorizontal: spacing.space4,
        paddingTop: spacing.space4,
        paddingBottom: spacing.space3,
        gap: spacing.space2,
      }}
    >
      {page.title ? <Text variant={page.titleHasName ? "title" : "headingM"}>{page.title}</Text> : null}
      {people.length > 0 ? <People people={people} /> : null}
      {page.message ? (
        <Text variant="small" tone="inkMuted">
          {page.message}
        </Text>
      ) : null}
    </View>
  );
}

/** One person, or a match: both players with their photos, "vs." between. */
function People({ people }: { people: SheetPerson[] }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing.space3,
      }}
    >
      {people.map((p, i) => (
        <React.Fragment key={`${p.name}-${i}`}>
          {i > 0 ? (
            <Text variant="small" tone="inkMuted">
              vs.
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.space2,
              flexShrink: 1,
            }}
          >
            <Avatar name={p.name} uri={p.photo} size={40} />
            <View style={{ flexShrink: 1 }}>
              <Text variant="bodyStrong">{p.name}</Text>
              {p.detail ? (
                <Text variant="small" tone="inkMuted">
                  {p.detail}
                </Text>
              ) : null}
            </View>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

function Row({ row, first, onPress }: { row: SheetRow; first: boolean; onPress: () => void }) {
  const c = useColors();
  const tint = row.destructive ? c.danger : c.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel ?? [row.label, row.detail].filter(Boolean).join(", ")}
      accessibilityHint={row.accessibilityHint ?? (row.next ? "Opens a list" : undefined)}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: 1,
        borderColor: c.hairline,
        backgroundColor: pressed ? c.sand : "transparent",
      })}
    >
      {row.person ? (
        <Avatar name={row.person.name} uri={row.person.photo} size={36} />
      ) : row.icon ? (
        <Icon name={row.icon} size={22} tintColor={tint} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" tone={row.destructive ? "danger" : "ink"}>
          {row.label}
        </Text>
        {row.detail ? (
          <Text variant="small" tone="inkMuted">
            {row.detail}
          </Text>
        ) : null}
      </View>
      {row.next ? <Icon name="chevron.right" size={13} tintColor={c.inkMuted} /> : null}
    </Pressable>
  );
}
