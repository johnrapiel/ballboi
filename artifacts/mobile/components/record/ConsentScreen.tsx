// The single consent screen was replaced by the first-run carousel
// (components/record/FirstRunCarousel.tsx, spec decisions 90 to 92). The
// training copy now lives in lib/recording/firstRun.ts; this re-export keeps
// Settings and the invite screen working until their owners point at it.
export { TRAINING_COPY } from "@/lib/recording/firstRun";
