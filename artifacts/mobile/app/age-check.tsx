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
// exactly 18 years ago; the latest selectable date is today.
//
// TODO(native build): ask Apple's Declared Age Range API first and fall back
// to this screen only when it returns nothing.

import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useAuth, useUser } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Screen, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  AGE_CHECK_PASSED,
  EARLIEST_BIRTH_DATE,
  ageOn,
  formatBirthday,
  isAgeCheckPassed,
  neutralStartDate,
} from "@/lib/ageCheck";

export default function AgeCheckScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoaded) return null;
  if (!isSignedIn || !user) return <Redirect href="/(auth)/welcome" />;
  if (isAgeCheckPassed(user.unsafeMetadata)) return <Redirect href="/(tabs)" />;

  async function submit() {
    if (!user || !birthDate) return;
    setError(null);
    setBusy(true);
    try {
      if (ageOn(birthDate, new Date()) >= 18) {
        await user.update({ unsafeMetadata: { ...user.unsafeMetadata, ageCheck: AGE_CHECK_PASSED } });
        router.replace("/(tabs)");
      } else {
        // No account for under-18s: remove the one sign-in just created.
        await user.delete();
        router.replace("/eighteen-plus");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ gap: spacing.space6 }}>
      <View style={{ gap: spacing.space2, marginTop: spacing.space8 }}>
        <Text variant="label" tone="inkMuted">
          One quick check
        </Text>
        <Text variant="displayL" accessibilityRole="header">
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

      <Button label="Continue" loading={busy} disabled={!birthDate} onPress={submit} style={{ marginTop: "auto" }} />

      <BirthdaySheet
        visible={sheetOpen}
        initial={birthDate ?? neutralStartDate(new Date())}
        onCancel={() => setSheetOpen(false)}
        onDone={(date) => {
          setBirthDate(date);
          setSheetOpen(false);
        }}
      />
    </Screen>
  );
}

/** Looks like a text field; opens the birthday sheet. Empty until confirmed. */
function BirthdayField({ value, onPress }: { value: Date | null; onPress: () => void }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
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
  onCancel,
  onDone,
}: {
  visible: boolean;
  initial: Date;
  onCancel: () => void;
  onDone: (date: Date) => void;
}) {
  const c = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(initial);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={() => setDraft(initial)}
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
            <SheetAction label="Done" strong onPress={() => onDone(draft)} />
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
              if (date) setDraft(date);
            }}
            style={{ alignSelf: "stretch" }}
          />
        </View>
      </View>
    </Modal>
  );
}

/** Text button in the sheet header, at least 44×44pt. */
function SheetAction({ label, strong = false, onPress }: { label: string; strong?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.space2}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        paddingHorizontal: spacing.space3,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text variant={strong ? "bodyStrong" : "body"}>{label}</Text>
    </Pressable>
  );
}
