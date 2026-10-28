// Continue with email: one-time code, no password.
// New emails get an account; existing ones sign in. Same two steps either way.
// Spec: Roles and onboarding, step 1 ("email code").

import { useSignIn, useSignUp } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { Button, Field, KeyboardScreen, Screen, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { clerkErrorCode, friendlyAuthError } from "@/lib/authErrors";

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
  // Stops a code from being checked twice (auto-submit plus a tap on Continue).
  const verifying = useRef(false);

  const emailLooksValid = /\S+@\S+\.\S+/.test(email.trim());

  async function sendCode() {
    setError(null);
    setCode("");
    setBusy(true);
    const emailAddress = email.trim();
    try {
      const { error: signInError } = await signIn.emailCode.sendCode({ emailAddress });
      if (!signInError) {
        setMode("signIn");
        setStep("code");
        return;
      }
      if (clerkErrorCode(signInError) !== "form_identifier_not_found") {
        setError(friendlyAuthError(signInError));
        return;
      }
      // No account yet: create one with the same email-code flow.
      const { error: createError } = await signUp.create({ emailAddress });
      if (createError) return setError(friendlyAuthError(createError));
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) return setError(friendlyAuthError(sendError));
      setMode("signUp");
      setStep("code");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(value: string = code) {
    if (verifying.current || value.length !== CODE_LENGTH) return;
    verifying.current = true;
    setError(null);
    setBusy(true);
    try {
      const resource = mode === "signIn" ? signIn : signUp;
      const { error: verifyError } =
        mode === "signIn"
          ? await signIn.emailCode.verifyCode({ code: value })
          : await signUp.verifications.verifyEmailCode({ code: value });
      if (verifyError) {
        logAuthIssue("verify", verifyError);
        return setError(friendlyAuthError(verifyError));
      }
      if (resource.status !== "complete") {
        logAuthIssue("status after verify", resource.status);
        return setError("Something went wrong. Try again.");
      }
      // The auth layout moves signed-in players on to the age check.
      const { error: finalizeError } = await resource.finalize();
      if (finalizeError) {
        logAuthIssue("finalize", finalizeError);
        setError(friendlyAuthError(finalizeError));
      }
    } catch (err) {
      logAuthIssue("unexpected", err);
      setError(friendlyAuthError(err));
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }

  // Checks the code as soon as all six digits are in, typed or autofilled.
  function onCodeChange(text: string) {
    const next = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(next);
    if (error) setError(null);
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
              hint={error ?? undefined}
              error={!!error}
            />
            <Button label="Resend code" variant="secondary" disabled={busy} onPress={sendCode} />
            <Button label="Continue" loading={busy} disabled={code.length !== CODE_LENGTH} onPress={() => void verifyCode()} style={{ marginTop: "auto" }} />
          </>
        )}
      </Screen>
    </KeyboardScreen>
  );
}
