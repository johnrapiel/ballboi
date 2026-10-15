import { pgTable, text, serial, timestamp, integer, real, json } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

export const courtsTable = pgTable("courts", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address").notNull(),
  zipCode: text("zip_code").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  surface: text("surface"),
  numberOfCourts: integer("number_of_courts").default(1),
  bookingLink: text("booking_link"),
  availableHoursStart: text("available_hours_start").default("06:00"),
  availableHoursEnd: text("available_hours_end").default("22:00"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Court = typeof courtsTable.$inferSelect;
export type InsertCourt = typeof courtsTable.$inferInsert;
