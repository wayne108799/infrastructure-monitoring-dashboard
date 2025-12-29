import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, integer, index } from "drizzle-orm/pg-core";
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
  // Management console links
  vcenterUrl: text("vcenter_url"),
  nsxUrl: text("nsx_url"),
  ariaUrl: text("aria_url"),
  veeamUrl: text("veeam_url"),
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
  businessId: text("business_id"),        // Custom 4-6 digit business ID
  businessName: text("business_name"),    // Custom business/customer name
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

// Global configuration (for Veeam ONE, etc.)
export const globalConfig = pgTable("global_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type GlobalConfig = typeof globalConfig.$inferSelect;

// Site poll snapshots - stores aggregated site metrics from each poll
export const sitePollSnapshots = pgTable("site_poll_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: text("site_id").notNull(),
  platformType: text("platform_type").notNull(),
  polledAt: timestamp("polled_at").notNull().defaultNow(),
  totalTenants: integer("total_tenants").default(0),
  totalVms: integer("total_vms").default(0),
  runningVms: integer("running_vms").default(0),
  summaryData: jsonb("summary_data"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_site_poll_site_polled").on(table.siteId, table.polledAt),
  index("idx_site_poll_polled").on(table.polledAt),
]);

export const insertSitePollSnapshotSchema = createInsertSchema(sitePollSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertSitePollSnapshot = z.infer<typeof insertSitePollSnapshotSchema>;
export type SitePollSnapshot = typeof sitePollSnapshots.$inferSelect;

// Tenant poll snapshots - stores per-tenant metrics from each poll
export const tenantPollSnapshots = pgTable("tenant_poll_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: text("site_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  orgName: text("org_name"),
  orgFullName: text("org_full_name"),
  polledAt: timestamp("polled_at").notNull().defaultNow(),
  vmCount: integer("vm_count").default(0),
  runningVmCount: integer("running_vm_count").default(0),
  allocationData: jsonb("allocation_data"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_tenant_poll_site_polled").on(table.siteId, table.polledAt),
  index("idx_tenant_poll_tenant_polled").on(table.tenantId, table.polledAt),
]);

export const insertTenantPollSnapshotSchema = createInsertSchema(tenantPollSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertTenantPollSnapshot = z.infer<typeof insertTenantPollSnapshotSchema>;
export type TenantPollSnapshot = typeof tenantPollSnapshots.$inferSelect;
