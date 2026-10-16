import { useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import { customFetch, useGetMyProfile } from "@workspace/api-client-react";
import { Button, Card, Screen, Text } from "@/components/ui";
import { config } from "@/lib/config";
import { MIN_TAP, space, useTheme } from "@/theme";

function LinkRow({ label, icon, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: MIN_TAP, flexDirection: "row", alignItems: "center", gap: space.md, opacity: pressed ? 0.7 : 1 })}
    >
      <Ionicons name={icon} size={20} color={c.textMuted} importantForAccessibility="no" />
      <Text style={{ flex: 1 }}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={c.textMuted} importantForAccessibility="no" />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const profile = useGetMyProfile();
  const name = profile.data?.displayName ?? user?.fullName ?? "Player";
  const [deleting, setDeleting] = useState(false);

  // App Store guideline 5.1.1(v): account deletion must be available in the app.
  function confirmDelete() {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your profile and every Ball Boi video you recorded. Past league results stay as \"Deleted player.\" This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await customFetch("/api/users/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
              await signOut();
            } catch {
              setDeleting(false);
              Alert.alert("Account not deleted", `Please try again or email ${config.supportEmail}.`);
            }
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <Card>
        <Text variant="title" accessibilityRole="header">{name}</Text>
        {profile.data ? <Text muted>NTRP {profile.data.skillLevel}</Text> : null}
        {user?.primaryEmailAddress ? <Text variant="footnote" muted>{user.primaryEmailAddress.emailAddress}</Text> : null}
      </Card>

      <Card>
        <LinkRow label="Privacy Policy" icon="shield-checkmark-outline" onPress={() => Linking.openURL(config.privacyPolicyUrl)} />
        <LinkRow label="Terms of Use" icon="document-text-outline" onPress={() => Linking.openURL(config.termsUrl)} />
        <LinkRow label="Contact support" icon="mail-outline" onPress={() => Linking.openURL(`mailto:${config.supportEmail}`)} />
      </Card>

      <View style={{ gap: space.md }}>
        <Button tone="secondary" label="Sign out" onPress={() => signOut()} />
        <Button tone="destructive" label="Delete account" loading={deleting} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}
