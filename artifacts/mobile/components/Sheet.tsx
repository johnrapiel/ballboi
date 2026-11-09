// The one bottom sheet (design system README, Bottom sheets; John, Nov 6,
// finding 9). Every sheet:
// - hugs its content and grows with larger text, scrolling only when it's
//   taller than the screen (the route uses `sheetOptions` from here),
// - has no Cancel: drag down to close, and if something changed it asks
//   before discarding it. The VoiceOver escape gesture closes it the same way,
// - has a left-aligned brush title under the grabber, read as the header,
// - ends on its primary action.

import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, ScrollView, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { fillSheetHeight } from "@/lib/sheetHeight";

/**
 * Stack options for a sheet route. `fill` is for a form taller than the screen
 * (New league): the large detent, with `SheetBody fill` giving its content a
 * definite height.
 */
export function sheetOptions(linen: string, opts: { fill?: boolean } = {}) {
  return {
    headerShown: false,
    presentation: "formSheet" as const,
    sheetAllowedDetents: opts.fill ? [1.0] : ("fitToContents" as const),
    sheetGrabberVisible: true,
    sheetCornerRadius: radius.radiusLg,
    contentStyle: { backgroundColor: linen },
  };
}

/**
 * Closing a sheet. While `dirty`, drag down, the escape gesture and `close()`
 * ask "Discard changes?" first. `finish()` closes without asking, for after a
 * save; `finish(go)` runs `go` instead of going back (a sheet that opens the
 * next screen in its place).
 */
export function useSheetClose(dirty: boolean) {
  const router = useRouter();
  const navigation = useNavigation();
  const [finished, setFinished] = useState(false);
  const next = useRef<(() => void) | null>(null);
  // Discard turns the guard off first, then leaves. Dispatching while the
  // guard was still on asked "Discard changes?" again, in a loop (John, Nov 7).
  const [discarding, setDiscarding] = useState(false);
  const leaveWith = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);

  usePreventRemove(dirty && !finished && !discarding, ({ data }) => {
    Alert.alert("Discard changes?", "What you entered in this sheet won't be saved.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          leaveWith.current = data.action;
          setDiscarding(true);
        },
      },
    ]);
  });

  useEffect(() => {
    if (!discarding || !leaveWith.current) return;
    const action = leaveWith.current;
    leaveWith.current = null;
    navigation.dispatch(action);
  }, [discarding, navigation]);

  // Once the guard is off, leave: back, or wherever `finish` was told to go.
  useEffect(() => {
    if (!finished) return;
    if (next.current) next.current();
    else if (router.canGoBack()) router.back();
  }, [finished, router]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);
  const finish = useCallback((then?: () => void) => {
    next.current = then ?? null;
    setFinished(true);
  }, []);
  return { close, finish };
}

export function SheetBody({
  title,
  dirty = false,
  close,
  fill = false,
  footer,
  children,
  contentStyle,
  scrollRef,
}: {
  title: string;
  /** Something was typed or picked: closing asks first. Ignored when `close` is passed. */
  dirty?: boolean;
  /** The sheet's own close, from `useSheetClose`, when the screen also needs `finish`. */
  close?: () => void;
  /** Fill the screen (New league). Otherwise the sheet hugs its content. */
  fill?: boolean;
  /** Pinned under the scrolling content, like a full-height form's primary button. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  scrollRef?: React.Ref<React.ComponentRef<typeof ScrollView>>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const own = useSheetClose(close ? false : dirty);
  const onEscape = close ?? own.close;

  // Hugging sheets (Wave 1 Fix 1b): the native `fitToContents` sheet sizes
  // itself from its content, and it only measures that reliably when the
  // content is a plain View with a definite height. A ScrollView with
  // `flexGrow: 0` and `maxHeight` left the sheet blank on iOS 26. So the
  // content is a plain View, and only when it's taller than the screen (very
  // large text) does it switch to a ScrollView with a fixed height. Once a
  // sheet scrolls it keeps scrolling until it closes, so it never flips back
  // and forth while someone types.
  const maxHeight = height - insets.top - spacing.space6;
  const [contentH, setContentH] = useState(0);
  const [footerH, setFooterH] = useState(0);
  const [tall, setTall] = useState(false);
  useEffect(() => {
    if (!fill && !tall && contentH + footerH > maxHeight) setTall(true);
  }, [fill, tall, contentH, footerH, maxHeight]);
  const scrolls = fill || tall;

  // Full-height sheet (New league). `flex: 1` collapses to zero height inside
  // the native formSheet on iOS 26, which left New league blank with only the
  // grabber showing. So it gets a definite height: the screen below the top
  // safe area, less the keyboard while it's up, so the footer's button stays
  // in view above it.
  const keyboardH = useKeyboardHeight(fill);
  const fillHeight = fillSheetHeight({ windowHeight: height, topInset: insets.top, keyboardHeight: keyboardH });

  const padding: StyleProp<ViewStyle> = [
    {
      paddingTop: spacing.space6,
      paddingHorizontal: spacing.space4,
      paddingBottom: footer ? spacing.space4 : insets.bottom + spacing.space4,
      gap: spacing.space4,
    },
    contentStyle,
  ];
  const content = (
    <>
      <Text variant="headingM" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </>
  );

  return (
    <View
      // The VoiceOver escape gesture (two-finger Z) closes the sheet.
      onAccessibilityEscape={onEscape}
      style={[{ backgroundColor: c.linen }, fill ? { height: fillHeight } : null]}
    >
      {scrolls ? (
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          // Full-height sheets: fills the definite-height root above the
          // footer. A hugging sheet that outgrew the screen gets a fixed
          // height so the native sheet can still measure it.
          style={fill ? { flex: 1 } : { height: Math.max(0, maxHeight - footerH) }}
          contentContainerStyle={padding}
        >
          {content}
        </ScrollView>
      ) : (
        <View onLayout={(e) => setContentH(e.nativeEvent.layout.height)} style={padding}>
          {content}
        </View>
      )}
      {footer ? (
        <View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={{
            paddingHorizontal: spacing.space4,
            paddingTop: spacing.space3,
            // Over the keyboard there's no home indicator to clear.
            paddingBottom: (keyboardH > 0 ? 0 : insets.bottom) + spacing.space3,
            borderTopWidth: 1,
            borderTopColor: c.hairline,
            backgroundColor: c.linen,
            gap: spacing.space2,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/**
 * How much of the screen the keyboard covers, in points, for a full-height
 * sheet (0 when it's down, or when `on` is false). Measured from the bottom of
 * the window, so a floating or split keyboard that covers nothing counts as 0.
 */
function useKeyboardHeight(on: boolean) {
  const { height } = useWindowDimensions();
  const [covered, setCovered] = useState(0);
  useEffect(() => {
    if (!on) return;
    const onFrame = (e: { endCoordinates: { screenY: number } }) =>
      setCovered(Math.max(0, height - e.endCoordinates.screenY));
    const show = Keyboard.addListener("keyboardWillShow", onFrame);
    const change = Keyboard.addListener("keyboardWillChangeFrame", onFrame);
    const hide = Keyboard.addListener("keyboardWillHide", () => setCovered(0));
    // The Name field's autoFocus can raise the keyboard before this subscribes.
    const now = Keyboard.metrics();
    if (now) setCovered(Math.max(0, height - now.screenY));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, [on, height]);
  return on ? covered : 0;
}
