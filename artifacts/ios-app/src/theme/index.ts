import { useColorScheme } from "react-native";
import { colors, type ThemeColors } from "./tokens";

export * from "./tokens";

export function useTheme(): { c: ThemeColors; scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { c: colors[scheme], scheme };
}
