import type { ExpoConfig } from "expo/config";

// App Store review reads every purpose string below. Keep them specific and
// plain: say what the permission is for and what the player gets from it.

const config: ExpoConfig = {
  name: "Ball Boi",
  slug: "ballboi",
  scheme: "ballboi",
  version: "0.1.0",
  orientation: "default", // Ball Boi records in landscape; the rest of the app is portrait-friendly
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#F5F0E8",
    dark: { image: "./assets/splash.png", backgroundColor: "#0F1520" },
  },
  ios: {
    bundleIdentifier: "app.ballboi.ios",
    buildNumber: "1",
    supportsTablet: false,
    usesAppleSignIn: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSCameraUsageDescription:
        "Ball Boi uses the camera to record your match so it can track your shots and build your replay.",
      NSMicrophoneUsageDescription:
        "Ball Boi records audio with your match video so ball strikes line up with your replay. You can turn audio off in Settings.",
      NSPhotoLibraryAddUsageDescription:
        "Save match replays and highlight clips to your Photos.",
      UIBackgroundModes: ["remote-notification"],
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeName",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePhotosorVideos",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeGameplayContent",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
      ],
      NSPrivacyAccessedAPITypes: [
        {
          // AsyncStorage / SecureStore and Expo modules read UserDefaults
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
      ],
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-apple-authentication",
    "expo-web-browser",
    [
      "expo-camera",
      {
        cameraPermission:
          "Ball Boi uses the camera to record your match so it can track your shots and build your replay.",
        microphonePermission:
          "Ball Boi records audio with your match video so ball strikes line up with your replay. You can turn audio off in Settings.",
        recordAudioAndroid: true,
      },
    ],
    ["expo-notifications", { color: "#00766A" }],
    "expo-font",
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? "https://ballboi.app/privacy",
    termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? "https://ballboi.app/terms",
    supportEmail: "support@ballboi.app",
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
