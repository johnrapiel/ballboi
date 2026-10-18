import { useSignUp } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handleSignUp = async () => {
    if (!email || !password) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    if (!code) return;
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/");
          if (!url.startsWith("http")) router.replace("/(tabs)" as any);
        },
      });
    }
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingTop: topPad + 20,
      paddingBottom: insets.bottom + 40,
    },
    logoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 40,
    },
    logoIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    appName: {
      fontSize: 22,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "DMSans_700Bold",
    },
    heading: {
      fontSize: 28,
      fontWeight: "700" as const,
      color: colors.foreground,
      marginBottom: 8,
      fontFamily: "DMSans_700Bold",
    },
    subheading: {
      fontSize: 15,
      color: colors.mutedForeground,
      marginBottom: 32,
      fontFamily: "DMSans_400Regular",
    },
    label: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: colors.foreground,
      marginBottom: 8,
      fontFamily: "DMSans_600SemiBold",
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.input,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      marginBottom: 16,
    },
    input: {
      flex: 1,
      paddingHorizontal: 14,
      paddingVertical: 14,
      fontSize: 15,
      color: colors.foreground,
      fontFamily: "DMSans_400Regular",
    },
    eyeBtn: {
      padding: 14,
    },
    errorText: {
      fontSize: 13,
      color: colors.destructive,
      marginBottom: 8,
      fontFamily: "DMSans_400Regular",
    },
    btn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 15,
      alignItems: "center",
      marginTop: 8,
    },
    btnDisabled: {
      opacity: 0.5,
    },
    btnText: {
      fontSize: 16,
      fontWeight: "700" as const,
      color: colors.primaryForeground,
      fontFamily: "DMSans_700Bold",
    },
    linkRow: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 4,
      marginTop: 24,
    },
    linkText: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
    link: {
      fontSize: 14,
      color: colors.primary,
      fontWeight: "600" as const,
      fontFamily: "DMSans_600SemiBold",
    },
  });

  const needsVerification =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

  if (needsVerification) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Ionicons name="tennisball" size={22} color={colors.primaryForeground} />
            </View>
            <Text style={styles.appName}>Ball Boi</Text>
          </View>
          <Text style={styles.heading}>Verify your email</Text>
          <Text style={styles.subheading}>
            We sent a code to {email}. Enter it below.
          </Text>
          <Text style={styles.label}>Verification code</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              autoFocus
            />
          </View>
          {errors?.fields?.code && (
            <Text style={styles.errorText}>{errors.fields.code.message}</Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.btn,
              (fetchStatus === "fetching" || !code) && styles.btnDisabled,
              { opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={handleVerify}
            disabled={fetchStatus === "fetching" || !code}
          >
            {fetchStatus === "fetching" ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.btnText}>Verify</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => signUp.verifications.sendEmailCode()}
            style={{ marginTop: 16, alignItems: "center" }}
          >
            <Text style={styles.link}>Resend code</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Ionicons name="tennisball" size={22} color={colors.primaryForeground} />
            </View>
            <Text style={styles.appName}>Ball Boi</Text>
          </View>
          <Text style={styles.heading}>Create account</Text>
          <Text style={styles.subheading}>
            Sign up to access your Ball Boi match replays.
          </Text>

          <Text style={styles.label}>Email</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {errors?.fields?.emailAddress && (
            <Text style={styles.errorText}>{errors.fields.emailAddress.message}</Text>
          )}

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
            />
            <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          </View>
          {errors?.fields?.password && (
            <Text style={styles.errorText}>{errors.fields.password.message}</Text>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              (!email || !password || fetchStatus === "fetching") && styles.btnDisabled,
              { opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={handleSignUp}
            disabled={!email || !password || fetchStatus === "fetching"}
          >
            {fetchStatus === "fetching" ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.btnText}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.linkRow}>
            <Text style={styles.linkText}>Already have an account?</Text>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable>
                <Text style={styles.link}>Sign in</Text>
              </Pressable>
            </Link>
          </View>

          <View nativeID="clerk-captcha" />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
