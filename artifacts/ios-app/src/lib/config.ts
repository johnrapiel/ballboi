import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const config = {
  apiUrl: extra.apiUrl ?? "http://localhost:8080",
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
  privacyPolicyUrl: extra.privacyPolicyUrl ?? "https://ballboi.app/privacy",
  termsUrl: extra.termsUrl ?? "https://ballboi.app/terms",
  supportEmail: extra.supportEmail ?? "support@ballboi.app",
};
