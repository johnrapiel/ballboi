import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: Array<{ name: string; title: string; icon: IconName }> = [
  { name: "index", title: "Home", icon: "home" },
  { name: "leagues", title: "Leagues", icon: "trophy" },
  { name: "ballboi", title: "Ball Boi", icon: "videocam" },
  { name: "profile", title: "Profile", icon: "person-circle" },
];

export default function TabLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: "DMSans_700Bold", fontSize: 11 },
        headerStyle: { backgroundColor: c.background },
        headerTitleStyle: { fontFamily: "DMSans_700Bold", color: c.text },
        headerShadowVisible: false,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.title,
            tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
