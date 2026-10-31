import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

// Spec (Video and training data): a consent screen before a person's first
// recording, and a training toggle that is on by default. A match enters the
// training set only if every player left it on; placeholder opponents are
// never trained on until they join.

export const recordingConsentTable = pgTable("ball_boi_recording_consent", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  /** When they agreed on the first-recording screen. Null until then. */
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  trainingEnabled: boolean("training_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RecordingConsent = typeof recordingConsentTable.$inferSelect;
