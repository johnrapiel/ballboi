import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { matchesTable } from "./matches";
import { playersTable } from "./players";

export const ballBoiSessionsTable = pgTable("ball_boi_sessions", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull().references(() => matchesTable.id, { onDelete: "cascade" }),
  recordedByClerkUserId: text("recorded_by_clerk_user_id").notNull(),
  status: text("status").notNull().default("recording"),
  recordingStartedAt: timestamp("recording_started_at", { withTimezone: true }).notNull().defaultNow(),
  recordingStoppedAt: timestamp("recording_stopped_at", { withTimezone: true }),
  videoObjectPath: text("video_object_path"),
  videoContentType: text("video_content_type"),
  videoSizeBytes: integer("video_size_bytes"),
  durationSeconds: integer("duration_seconds"),
  processingStatus: text("processing_status").notNull().default("pending"),
  processingError: text("processing_error"),
  aiNarrative: text("ai_narrative"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const matchShotsTable = pgTable("match_shots", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => ballBoiSessionsTable.id, { onDelete: "cascade" }),
  matchId: integer("match_id").notNull().references(() => matchesTable.id, { onDelete: "cascade" }),
  sequenceNumber: integer("sequence_number").notNull(),
  rallyNumber: integer("rally_number").notNull().default(1),
  playerId: integer("player_id").references(() => playersTable.id, { onDelete: "set null" }),
  timestampSeconds: real("timestamp_seconds").notNull(),
  shotType: text("shot_type").notNull(),
  shotTypeConfidence: real("shot_type_confidence"),
  outcome: text("outcome"),
  outcomeConfidence: real("outcome_confidence"),
  courtZoneName: text("court_zone_name"),
  courtZoneX: real("court_zone_x"),
  courtZoneY: real("court_zone_y"),
  contactX: real("contact_x"),
  contactY: real("contact_y"),
  speedMph: real("speed_mph"),
  spinType: text("spin_type"),
  depth: text("depth"),
  angleDegrees: real("angle_degrees"),
  playerStance: text("player_stance"),
  clipStartSeconds: real("clip_start_seconds"),
  clipEndSeconds: real("clip_end_seconds"),
  rawMlData: jsonb("raw_ml_data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchStatisticsTable = pgTable("match_statistics", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => ballBoiSessionsTable.id, { onDelete: "cascade" }),
  matchId: integer("match_id").notNull().references(() => matchesTable.id, { onDelete: "cascade" }),
  totalShots: integer("total_shots").notNull().default(0),
  totalRallies: integer("total_rallies").notNull().default(0),
  avgRallyLength: real("avg_rally_length").notNull().default(0),
  avgShotSpeedMph: real("avg_shot_speed_mph").notNull().default(0),
  fastestShotMph: real("fastest_shot_mph").notNull().default(0),
  winners: integer("winners").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  serves: integer("serves").notNull().default(0),
  forehands: integer("forehands").notNull().default(0),
  backhands: integer("backhands").notNull().default(0),
  volleys: integer("volleys").notNull().default(0),
  overheads: integer("overheads").notNull().default(0),
  heatmapData: jsonb("heatmap_data").$type<Array<Record<string, unknown>>>().notNull().default([]),
  shotTypeBreakdown: jsonb("shot_type_breakdown").$type<Record<string, number>>().notNull().default({}),
  outcomeBreakdown: jsonb("outcome_breakdown").$type<Record<string, number>>().notNull().default({}),
  playerComparisons: jsonb("player_comparisons").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type BallBoiSession = typeof ballBoiSessionsTable.$inferSelect;
export type MatchShot = typeof matchShotsTable.$inferSelect;
export type MatchStatistics = typeof matchStatisticsTable.$inferSelect;