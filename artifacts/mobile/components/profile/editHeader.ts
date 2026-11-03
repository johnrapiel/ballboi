import { useColors } from "@/hooks/useColors";

/**
 * Header for the Edit profile screens: standard iOS back at the top left,
 * matching the other pushed screens (Messages, Delete account). Set per
 * screen with <Stack.Screen options={...} />, so the root layout is unchanged.
 */
export function useEditHeader(title: string) {
  const c = useColors();
  return {
    headerShown: true,
    title,
    headerBackTitle: "Back",
    headerBackButtonDisplayMode: "minimal",
    headerShadowVisible: false,
    headerTintColor: c.ink,
    headerStyle: { backgroundColor: c.paper },
    headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: c.ink },
  } as const;
}
