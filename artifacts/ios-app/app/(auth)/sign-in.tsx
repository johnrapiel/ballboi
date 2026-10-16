import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, TextInput, View } from "react-native";
import { isClerkAPIResponseError, useSignIn, useSignUp, useSSO } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Button, Screen, Text } from "@/components/ui";
import { config } from "@/lib/config";
import { MIN_TAP, radius, space, useTheme } from "@/theme";

WebBrowser.maybeCompleteAuthSession();

type Step = { kind: "start" } | { kind: "code"; email: string; mode: "signIn" | "signUp" };

function errorMessage(err: unknown): string {
  if (isClerkAPIResponseError(err)) return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "Something went wrong.";
  return "Something went wrong. Check your connection and try again.";
}

export default function SignInScreen() {
  const { c, scheme } = useTheme();
  const { startSSOFlow } = useSSO();
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sso(strategy: "oauth_apple" | "oauth_google") {
    setError(null);
    setBusy(strategy);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri({ scheme: "ballboi", path: "sso-callback" }),
      });
      if (createdSessionId) await setActive?.({ session: createdSessionId });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    if (!signInLoaded || !signUpLoaded) return;
    const address = email.trim().toLowerCase();
    setError(null);
    setBusy("email");
    try {
      const attempt = await signIn.create({ identifier: address });
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (!factor || !("emailAddressId" in factor)) throw new Error("Email code sign-in is not enabled.");
      await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      setStep({ kind: "code", email: address, mode: "signIn" });
    } catch (err) {
      // New player: create the account and verify the same way.
      if (isClerkAPIResponseError(err) && err.errors[0]?.code === "form_identifier_not_found") {
        try {
          await signUp.create({ emailAddress: address });
          await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
          setStep({ kind: "code", email: address, mode: "signUp" });
        } catch (signUpErr) {
          setError(errorMessage(signUpErr));
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode() {
    if (step.kind !== "code" || !signInLoaded || !signUpLoaded) return;
    setError(null);
    setBusy("verify");
    try {
      if (step.mode === "signIn") {
        const res = await signIn.attemptFirstFactor({ strategy: "email_code", code: code.trim() });
        if (res.status === "complete") await setSignInActive({ session: res.createdSessionId });
      } else {
        const res = await signUp.attemptEmailAddressVerification({ code: code.trim() });
        if (res.status === "complete") await setSignUpActive({ session: res.createdSessionId });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const inputStyle = {
    minHeight: MIN_TAP,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    backgroundColor: c.surface,
    color: c.text,
    fontFamily: "DMSans_400Regular",
    fontSize: 17,
  } as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen style={{ paddingTop: 96 }}>
        <View style={{ gap: space.sm }}>
          <Text variant="display" accessibilityRole="header">
            Ball Boi
          </Text>
          <Text muted>Find players at your level, run your league, and replay every shot.</Text>
        </View>

        {step.kind === "start" ? (
          <View style={{ gap: space.md }}>
            <Button
              tone="apple"
              label="Continue with Apple"
              icon={<Ionicons name="logo-apple" size={20} color={scheme === "dark" ? "#000" : "#FFF"} />}
              loading={busy === "oauth_apple"}
              onPress={() => sso("oauth_apple")}
            />
            <Button
              tone="secondary"
              label="Continue with Google"
              icon={<Ionicons name="logo-google" size={18} color={c.text} />}
              loading={busy === "oauth_google"}
              onPress={() => sso("oauth_google")}
            />
            <Text variant="label" muted style={{ textAlign: "center", marginVertical: space.sm }}>
              OR USE EMAIL
            </Text>
            <TextInput
              accessibilityLabel="Email address"
              placeholder="you@example.com"
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={sendCode}
              style={inputStyle}
            />
            <Button label="Email me a code" loading={busy === "email"} disabled={!email.includes("@")} onPress={sendCode} />
          </View>
        ) : (
          <View style={{ gap: space.md }}>
            <Text>Enter the 6-digit code we sent to {step.email}.</Text>
            <TextInput
              accessibilityLabel="Verification code"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
              onSubmitEditing={verifyCode}
              style={[inputStyle, { letterSpacing: 6 }]}
            />
            <Button label="Verify and continue" loading={busy === "verify"} disabled={code.trim().length < 6} onPress={verifyCode} />
            <Button tone="secondary" label="Use a different email" onPress={() => { setStep({ kind: "start" }); setCode(""); }} />
          </View>
        )}

        {error ? (
          <Text color={c.destructive} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Text variant="footnote" muted style={{ textAlign: "center" }}>
          By continuing you agree to our{" "}
          <Text variant="footnote" color={c.primary} accessibilityRole="link" onPress={() => Linking.openURL(config.termsUrl)}>
            Terms
          </Text>{" "}
          and{" "}
          <Text variant="footnote" color={c.primary} accessibilityRole="link" onPress={() => Linking.openURL(config.privacyPolicyUrl)}>
            Privacy Policy
          </Text>
          .
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}
