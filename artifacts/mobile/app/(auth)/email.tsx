// Continue with email: one-time code, no password.
// New emails get an account; existing ones sign in. Same two steps either way.
// Spec: Roles and onboarding, step 1 ("email code").
//
// When codes keep failing (Wave 1 review A1, A2):
// - After three wrong codes, or two resends without signing in, the error line
//   points to Apple or Google, or another email. Nobody is locked out: the code
//   field keeps working.
// - Resend code waits 30 seconds after each send, with a visible countdown.
//   VoiceOver hears it once, when the code is sent, not every second.
// - Every error is also spoken: iOS doesn't announce the field's error line
//   on its own.

import { useSignIn, useSignUp } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";

import { Button, Field, KeyboardScreen, Screen, Text, TextLink } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { clerkErrorCode, friendlyAuthError } from "@/lib/authErrors";
import {
  NO_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  STEER_MESSAGE,
  afterSend,
  afterWrongCode,
  isWrongCodeError,
  resendSecondsLeft,
  shouldSteer,
} from "@/lib/emailCodeAttempts";

const CODE_LENGTH = 6;

/** Prints the real Clerk cause to the Metro terminal in development builds. */
function logAuthIssue(step: string, detail: unknown) {
  if (__DEV__) console.warn(`[auth] ${step}:`, clerkErrorCode(detail) ?? detail);
}

type Step = "email" | "code";
type Mode = "signIn" | "signUp";

export default function EmailScreen() {
  const router = useRouter();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  const [step, setStep] = useState<Step>("email");
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True when the current error is a wrong code, which the steer line replaces. */
  const [errorIsWrongCode, setErrorIsWrongCode] = useState(false);
  const [attempts, setAttempts] = useState(NO_ATTEMPTS);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Stops a code from being checked twice (auto-submit plus a tap on Continue).
  const verifying = useRef(false);

  const emailLooksValid = /\S+@\S+\.\S+/.test(email.trim());
  const resendIn = resendSecondsLeft(lastSentAt, now);
  const steer = step === "code" && shouldSteer(attempts);
  // The steer line stands in for wrong-code errors; other errors (no
  // connection, too many tries) still show their own reason.
  const showSteer = steer && (errorIsWrongCode || !error);

  // Ticks the "Resend in 24s" label once a second, only while it's counting.
  useEffect(() => {
    if (resendSecondsLeft(lastSentAt, Date.now()) === 0) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (resendSecondsLeft(lastSentAt, t) === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [lastSentAt]);

  /**
   * Shows an error under the code field and says it to VoiceOver. `spoken`
   * replaces the visible text when the steer line is showing instead.
   */
  function showError(message: string, opts: { wrongCode?: boolean; spoken?: string } = {}) {
    setError(message);
    setErrorIsWrongCode(!!opts.wrongCode);
    AccessibilityInfo.announceForAccessibility(opts.spoken ?? message);
  }

  function clearError() {
    setError(null);
    setErrorIsWrongCode(false);
  }

  /**
   * Counts the send, starts the 30-second wait, and moves to the code step.
   * One announcement covers both, so the second resend's steer line doesn't
   * cut off "Code sent".
   */
  function codeSent(emailAddress: string, nextMode: Mode) {
    const sentAt = Date.now();
    const next = afterSend(attempts, emailAddress);
    setAttempts(next);
    setLastSentAt(sentAt);
    setNow(sentAt);
    setMode(nextMode);
    setStep("code");
    AccessibilityInfo.announceForAccessibility(
      shouldSteer(next)
        ? `Code sent. ${STEER_MESSAGE}`
        : `Code sent. You can resend in ${RESEND_COOLDOWN_SECONDS} seconds.`,
    );
  }

  /** "another email": back to the email step with an empty field. */
  function chooseAnotherEmail() {
    clearError();
    setCode("");
    setEmail("");
    setStep("email");
  }

  /** "Apple or Google": back to the welcome screen. */
  function chooseAppleOrGoogle() {
    router.dismissTo("/(auth)/welcome");
  }

  async function sendCode() {
    clearError();
    setCode("");
    setBusy(true);
    const emailAddress = email.trim();
    try {
      const { error: signInError } = await signIn.emailCode.sendCode({ emailAddress });
      if (!signInError) {
        codeSent(emailAddress, "signIn");
        return;
      }
      if (clerkErrorCode(signInError) !== "form_identifier_not_found") {
        showError(friendlyAuthError(signInError));
        return;
      }
      // No account yet: create one with the same email-code flow.
      const { error: createError } = await signUp.create({ emailAddress });
      if (createError) return showError(friendlyAuthError(createError));
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) return showError(friendlyAuthError(sendError));
      codeSent(emailAddress, "signUp");
    } catch (err) {
      showError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(value: string = code) {
    if (verifying.current || value.length !== CODE_LENGTH) return;
    verifying.current = true;
    clearError();
    setBusy(true);
    try {
      const resource = mode === "signIn" ? signIn : signUp;
      const { error: verifyError } =
        mode === "signIn"
          ? await signIn.emailCode.verifyCode({ code: value })
          : await signUp.verifications.verifyEmailCode({ code: value });
      if (verifyError) {
        logAuthIssue("verify", verifyError);
        const message = friendlyAuthError(verifyError);
        if (!isWrongCodeError(clerkErrorCode(verifyError))) return showError(message);
        const next = afterWrongCode(attempts);
        setAttempts(next);
        // From the third wrong code on, the steer line replaces the error, so
        // VoiceOver hears both that the code failed and where to go next.
        return showError(message, { wrongCode: true, spoken: shouldSteer(next) ? `${message} ${STEER_MESSAGE}` : message });
      }
      if (resource.status !== "complete") {
        logAuthIssue("status after verify", resource.status);
        return showError("Something went wrong. Try again.");
      }
      // The auth layout moves signed-in players on to the age check.
      const { error: finalizeError } = await resource.finalize();
      if (finalizeError) {
        logAuthIssue("finalize", finalizeError);
        showError(friendlyAuthError(finalizeError));
      }
    } catch (err) {
      logAuthIssue("unexpected", err);
      showError(friendlyAuthError(err));
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }

  // Checks the code as soon as all six digits are in, typed or autofilled.
  function onCodeChange(text: string) {
    const next = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(next);
    if (error) clearError();
    if (next.length === CODE_LENGTH) void verifyCode(next);
  }

  return (
    <KeyboardScreen>
      <Screen style={{ gap: spacing.space6 }}>
        <Pressable
          onPress={() => (step === "code" ? setStep("email") : router.back())}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", alignSelf: "flex-start" }}
        >
          <Text>Back</Text>
        </Pressable>

        {step === "email" ? (
          <>
            <View style={{ gap: spacing.space2 }}>
              <Text variant="displayL" accessibilityRole="header">
                Your email
              </Text>
              <Text tone="inkMuted">We'll send a 6-digit code. No password to remember.</Text>
            </View>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={() => emailLooksValid && void sendCode()}
              hint={error ?? undefined}
              error={!!error}
            />
            <Button label="Send code" loading={busy} disabled={!emailLooksValid} onPress={sendCode} style={{ marginTop: "auto" }} />
          </>
        ) : (
          <>
            <View style={{ gap: spacing.space2 }}>
              <Text variant="displayL" accessibilityRole="header">
                Check your email
              </Text>
              <Text tone="inkMuted">Enter the code we sent to {email.trim()}.</Text>
            </View>
            <Field
              label="Code"
              value={code}
              onChangeText={onCodeChange}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={CODE_LENGTH}
              returnKeyType="done"
              onSubmitEditing={() => void verifyCode()}
              hint={showSteer ? undefined : (error ?? undefined)}
              error={!!error}
            />
            {showSteer ? (
              <SteerLine onAppleOrGoogle={chooseAppleOrGoogle} onAnotherEmail={chooseAnotherEmail} />
            ) : null}
            <Button
              label={resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              // Fixed while counting, so VoiceOver never reads every tick.
              accessibilityLabel={resendIn > 0 ? "Resend code, available shortly" : "Resend code"}
              variant="secondary"
              disabled={busy || resendIn > 0}
              onPress={() => resendIn === 0 && void sendCode()}
              // The shared 50% disabled dim drops the countdown to 3:1. At 75%
              // it reads at 6:1 (Day) and 8.3:1 (Night) and still looks waiting.
              style={resendIn > 0 && !busy ? { opacity: 0.75 } : undefined}
            />
            <Button label="Continue" loading={busy} disabled={code.length !== CODE_LENGTH} onPress={() => void verifyCode()} style={{ marginTop: "auto" }} />
          </>
        )}
      </Screen>
    </KeyboardScreen>
  );
}

/**
 * "Still not working? Try Apple or Google instead, or use another email."
 * Both phrases are links. VoiceOver reads the line once and offers the two
 * choices as actions (swipe up or down), so nobody has to find a link inside
 * a sentence.
 */
function SteerLine({ onAppleOrGoogle, onAnotherEmail }: { onAppleOrGoogle: () => void; onAnotherEmail: () => void }) {
  return (
    <Text
      tone="danger"
      accessible
      accessibilityLabel={STEER_MESSAGE}
      accessibilityHint="Swipe up or down to choose Apple or Google, or another email."
      accessibilityActions={[
        { name: "appleOrGoogle", label: "Try Apple or Google" },
        { name: "anotherEmail", label: "Use another email" },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "appleOrGoogle") onAppleOrGoogle();
        if (e.nativeEvent.actionName === "anotherEmail") onAnotherEmail();
      }}
    >
      Still not working? Try <TextLink onPress={onAppleOrGoogle}>Apple or Google</TextLink> instead, or use{" "}
      <TextLink onPress={onAnotherEmail}>another email</TextLink>.
    </Text>
  );
}
