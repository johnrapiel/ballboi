// Age check, right after first sign-in.
// Spec: Roles and onboarding, step 2 (decision: birthday wheels picker).
// Ball Boi is 18+ for the MVP, but this screen never says so: the prompt is
// a neutral "What's your birthday?". Only a pass flag is stored (on the Clerk
// user). The birth date never leaves this screen. Under 18: the account is
// deleted and the person sees the "18+ for now" screen.
//
// The birthday is picked with the native iOS date picker in wheels style, in a
// bottom sheet with Cancel and Done. No calendar grid, no typed fields.
// The field stays empty until Done; the wheels start on a neutral date, never
// exactly 18 years ago; the latest selectable date is today. Done stays off
// until a wheel moves, so the untouched start date can't pass the check
// (Wave 1 review S2, John's call: option c).
//
// A quiet Sign out sits under Continue, so someone who signed in with the
// wrong account has a way out (S3).
//
// Apple's age range comes first (Session G, acceptance 36): on iOS 26 and
// later, iOS asks the person whether to share their age range with Ball Boi.
// An adult goes straight past this step; under 18 gets "18+ for now" and no
// account. Not shared or not available: this birthday step. Only the pass
// flag is stored, never the range (lib/ageCheck.ts).

import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useAuth, useUser } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ScrollScreen, Screen, Text, TextButton } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors, useScheme } from "@/hooks/useColors";
import {
  AGE_CHECK_PASSED,
  AGE_GATE,
  EARLIEST_BIRTH_DATE,
  ageOn,
  ageRangeOutcome,
  canAskAppleAgeRange,
  formatBirthday,
  neutralStartDate,
} from "@/lib/ageCheck";
import { confirmSignOut } from "@/lib/confirmSignOut";

export default function AgeCheckScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();

  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** On the way to the 18+ screen: deleting the account signs them out first. */
  const [leaving, setLeaving] = useState(false);
  /** Asking Apple for the age range first (iOS 26 and later); the birthday step waits. */
  const [askingApple, setAskingApple] = useState(() => canAskAppleAgeRange(Platform.OS, Platform.Version));
  const askedApple = useRef(false);

  /** Adult: save the pass flag. Under 18: delete the account just made. Shared by both checks. */
  async function decide(adult: boolean) {
    if (!user) return;
    if (adult) {
      // The root gate moves on to onboarding, or Home, once this is saved.
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, ageCheck: AGE_CHECK_PASSED } });
    } else {
      // No account for under-18s: remove the one sign-in just created.
      setLeaving(true);
      await user.delete();
      router.replace("/eighteen-plus");
    }
  }

  useEffect(() => {
    if (!askingApple || askedApple.current || !isLoaded || !isSignedIn || !user) return;
    askedApple.current = true;
    (async () => {
      let outcome: ReturnType<typeof ageRangeOutcome> = "askBirthday";
      try {
        // Loaded here so Expo Go and older builds, without the native module, fall back to the birthday step.
        const AgeRange = (await import("expo-age-range")) as typeof import("expo-age-range");
        outcome = ageRangeOutcome(await AgeRange.requestAgeRangeAsync({ threshold1: AGE_GATE }));
      } catch {
        // Not shared, not signed in to iCloud, or not available: the birthday step.
      }
      try {
        if (outcome !== "askBirthday") {
          await decide(outcome === "adult");
          return;
        }
      } catch {
        setLeaving(false);
        // Couldn't save: the birthday step still works, with Continue to try again.
      }
      setAskingApple(false);
    })();
    // Once, when the signed-in user is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askingApple, isLoaded, isSignedIn, user]);

  if (!isLoaded) return null;
  if (!isSignedIn || !user) return leaving ? <Screen /> : <Redirect href="/(auth)/welcome" />;

  if (askingApple || leaving) {
    return (
      <Screen style={{ justifyContent: "center", alignItems: "center", gap: spacing.space4 }}>
        <ActivityIndicator accessibilityLabel="Checking your age" />
        <Text tone="inkMuted" style={{ textAlign: "center" }}>
          One quick check
        </Text>
      </Screen>
    );
  }

  async function submit() {
    if (!user || !birthDate) return;
    setError(null);
    setBusy(true);
    try {
      await decide(ageOn(birthDate, new Date()) >= AGE_GATE);
    } catch {
      setLeaving(false);
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollScreen style={{ gap: spacing.space6 }}>
      <View style={{ gap: spacing.space2, marginTop: spacing.space8 }}>
        <Text variant="label" tone="inkMuted">
          One quick check
        </Text>
        <Text variant="headingL" accessibilityRole="header">
          What's your birthday?
        </Text>
        <Text tone="inkMuted">We only keep a yes or no, never your birthday.</Text>
      </View>

      <BirthdayField value={birthDate} onPress={() => setSheetOpen(true)} />

      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={{ marginTop: "auto", gap: spacing.space2 }}>
        <Button label="Continue" loading={busy} disabled={!birthDate} onPress={submit} />
        <TextButton label="Sign out" disabled={busy} onPress={() => void confirmSignOut(signOut).catch(() => undefined)} />
      </View>

      <BirthdaySheet
        visible={sheetOpen}
        initial={birthDate ?? neutralStartDate(new Date())}
        alreadyChosen={!!birthDate}
        onCancel={() => setSheetOpen(false)}
        onDone={(date) => {
          setBirthDate(date);
          setSheetOpen(false);
        }}
      />
    </ScrollScreen>
  );
}

/** Looks like a text field; opens the birthday sheet. Empty until confirmed. */
function BirthdayField({ value, onPress }: { value: Date | null; onPress: () => void }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="section" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
        Birthday
      </Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Birthday"
        accessibilityValue={{ text: value ? formatBirthday(value) : "Not set" }}
        accessibilityHint="Opens a date picker"
        style={({ pressed }) => ({
          minHeight: 48,
          justifyContent: "center",
          paddingHorizontal: 14,
          borderRadius: radius.radiusSm,
          borderWidth: 1,
          borderColor: c.hairlineStrong,
          backgroundColor: c.linen,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text tone={value ? "ink" : "inkMuted"}>{value ? formatBirthday(value) : "Choose a date"}</Text>
      </Pressable>
    </View>
  );
}

/** Bottom sheet with the native wheels picker, Cancel and Done. */
function BirthdaySheet({
  visible,
  initial,
  alreadyChosen,
  onCancel,
  onDone,
}: {
  visible: boolean;
  initial: Date;
  /** A date was already picked, so Done works right away. */
  alreadyChosen: boolean;
  onCancel: () => void;
  onDone: (date: Date) => void;
}) {
  const c = useColors();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState(initial);
  /** Done stays off until a wheel moves (S2). */
  const [moved, setMoved] = useState(alreadyChosen);

  return (
    <Modal
      visible={visible}
      transparent
      // Reduce Motion: fade in place of the slide up (A22).
      animationType={reduceMotion ? "fade" : "slide"}
      onShow={() => {
        setDraft(initial);
        setMoved(alreadyChosen);
      }}
      onRequestClose={onCancel}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Tapping outside the sheet cancels, like a native sheet. Cancel covers VoiceOver. */}
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0, 0, 0, 0.35)" }}
          onPress={onCancel}
          accessible={false}
          importantForAccessibility="no"
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.linen,
            borderTopLeftRadius: radius.radiusLg,
            borderTopRightRadius: radius.radiusLg,
            borderColor: c.hairline,
            borderWidth: 1,
            paddingBottom: insets.bottom + spacing.space4,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: spacing.space2,
              borderBottomWidth: 1,
              borderBottomColor: c.hairline,
            }}
          >
            <SheetAction label="Cancel" onPress={onCancel} />
            <Text variant="bodyStrong" accessibilityRole="header" style={{ flexShrink: 1, textAlign: "center" }}>
              Birthday
            </Text>
            <SheetAction
              label="Done"
              strong
              disabled={!moved}
              accessibilityHint={moved ? undefined : "Turn a wheel to choose your birthday first"}
              onPress={() => onDone(draft)}
            />
          </View>

          <DateTimePicker
            value={draft}
            mode="date"
            display="spinner"
            minimumDate={EARLIEST_BIRTH_DATE}
            maximumDate={new Date()}
            themeVariant={scheme === "dark" ? "dark" : "light"}
            textColor={c.ink}
            accessibilityLabel="Birthday"
            onChange={(_: DateTimePickerEvent, date?: Date) => {
              if (date) {
                setDraft(date);
                setMoved(true);
              }
            }}
            style={{ alignSelf: "stretch" }}
          />
        </View>
      </View>
    </Modal>
  );
}

/** Text button in the sheet header, at least 44×44pt. */
function SheetAction({
  label,
  strong = false,
  disabled = false,
  accessibilityHint,
  onPress,
}: {
  label: string;
  strong?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      hitSlop={spacing.space2}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        paddingHorizontal: spacing.space3,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Text variant={strong ? "bodyStrong" : "body"}>{label}</Text>
    </Pressable>
  );
}
