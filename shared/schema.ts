import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const platformSites = pgTable("platform_sites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: text("site_id").notNull().unique(),
  platformType: text("platform_type").notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  url: text("url").notNull(),
  username: text("username"),
  password: text("password"),
  org: text("org"),
  apiKey: text("api_key"),
  secretKey: text("secret_key"),
  realm: text("realm"),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlatformSiteSchema = createInsertSchema(platformSites).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updatePlatformSiteSchema = insertPlatformSiteSchema.partial();

export type InsertPlatformSite = z.infer<typeof insertPlatformSiteSchema>;
export type UpdatePlatformSite = z.infer<typeof updatePlatformSiteSchema>;
export type PlatformSite = typeof platformSites.$inferSelect;
