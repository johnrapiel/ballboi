// Every icon in Ball Boi is hand-drawn (John, Nov 7, 2026). Fails if any
// screen or component draws an icon some other way (SF Symbols, an icon font
// or an icon library), or names an icon that has no brush drawing.
// Use <Icon name="..."> from components/Icon; draw new icons in
// scripts/design/brush-icons.py. Runs in `pnpm test`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const app = new URL("../artifacts/mobile/", import.meta.url).pathname;
const BANNED = [
  /from ["']expo-symbols["']/,
  /from ["']@expo\/vector-icons/,
  /from ["']react-native-vector-icons/,
  /from ["']lucide-react-native["']/,
  /from ["']react-native-heroicons/,
  /from ["']phosphor-react-native["']/,
  /["']sf:[a-z]/, // native tab or header SF Symbol shortcuts
];

const sources = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });

const files = ["app", "components", "hooks", "lib"].flatMap((d) => sources(join(app, d)));
const drawn = new Set(
  [...readFileSync(join(app, "components/icons/brushPaths.ts"), "utf8").matchAll(/^  "([^"]+)":$/gm)].map((m) => m[1]),
);

const problems = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(app.length);
  if (BANNED.some((re) => re.test(src))) problems.push(`${rel}: uses SF Symbols or an icon library; use <Icon> instead`);
  for (const m of src.matchAll(/<Icon\s[^>]*?name="([^"]+)"/g))
    if (!drawn.has(m[1])) problems.push(`${rel}: no brush drawing for "${m[1]}"; add it in scripts/design/brush-icons.py`);
}

if (problems.length) {
  console.error("Brush icons check failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`pass  brush icons: ${files.length} files, ${drawn.size} drawings, no SF Symbols or icon libraries`);
