import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

// Spec (Video and training data): a consent screen before a person's first
// recording, and a training toggle that is on by default. A match enters the
// training set only if every player left it on; placeholder opponents are
// never trained on until they join.
//
// Beta (spec decisions 85 and 92, B2 and B9): while the beta backend's
// BETA_RELEASE_REQUIRED setting is on, testers also agree to the Ball Boi
// Beta Footage Release. The version they agreed to and when are stored here,
// so a new version asks again.

export const recordingConsentTable = pgTable("ball_boi_recording_consent", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  /** When they agreed on the first-recording screen. Null until then. */
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  trainingEnabled: boolean("training_enabled").notNull().default(true),
  /** The Beta Footage Release version they agreed to. Null if never. */
  releaseVersion: integer("release_version"),
  /** When they agreed to that version. */
  releaseAgreedAt: timestamp("release_agreed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RecordingConsent = typeof recordingConsentTable.$inferSelect;
