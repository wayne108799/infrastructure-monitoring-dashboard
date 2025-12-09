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

// Minimum commit levels per tenant
export const tenantCommitLevels = pgTable("tenant_commit_levels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: text("site_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  vcpuCount: text("vcpu_count"),          // e.g., "10"
  vcpuSpeedGhz: text("vcpu_speed_ghz"),   // e.g., "2.8"
  ramGB: text("ram_gb"),                   // e.g., "25"
  storageHpsGB: text("storage_hps_gb"),   // e.g., "200"
  storageSpsGB: text("storage_sps_gb"),   // e.g., "200"
  storageVvolGB: text("storage_vvol_gb"), // e.g., "0"
  storageOtherGB: text("storage_other_gb"), // for non-VCD platforms
  allocatedIps: text("allocated_ips"),     // e.g., "5"
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTenantCommitLevelSchema = createInsertSchema(tenantCommitLevels).omit({
  id: true,
  updatedAt: true,
});

export const updateTenantCommitLevelSchema = insertTenantCommitLevelSchema.partial();

export type InsertTenantCommitLevel = z.infer<typeof insertTenantCommitLevelSchema>;
export type UpdateTenantCommitLevel = z.infer<typeof updateTenantCommitLevelSchema>;
export type TenantCommitLevel = typeof tenantCommitLevels.$inferSelect;
