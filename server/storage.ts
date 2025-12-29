import { 
  type User, 
  type InsertUser, 
  type PlatformSite, 
  type InsertPlatformSite, 
  type UpdatePlatformSite,
  type TenantCommitLevel,
  type InsertTenantCommitLevel,
  type UpdateTenantCommitLevel,
  type GlobalConfig,
  type SiteStorageConfig,
  type InsertSiteStorageConfig,
  users,
  platformSites,
  tenantCommitLevels,
  globalConfig,
  siteStorageConfig
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getAllPlatformSites(): Promise<PlatformSite[]>;
  getPlatformSite(id: string): Promise<PlatformSite | undefined>;
  getPlatformSiteBySiteId(siteId: string): Promise<PlatformSite | undefined>;
  createPlatformSite(site: InsertPlatformSite): Promise<PlatformSite>;
  updatePlatformSite(id: string, site: UpdatePlatformSite): Promise<PlatformSite | undefined>;
  deletePlatformSite(id: string): Promise<boolean>;
  
  getAllCommitLevels(): Promise<TenantCommitLevel[]>;
  getCommitLevelsBySite(siteId: string): Promise<TenantCommitLevel[]>;
  getCommitLevel(siteId: string, tenantId: string): Promise<TenantCommitLevel | undefined>;
  upsertCommitLevel(level: InsertTenantCommitLevel): Promise<TenantCommitLevel>;
  deleteCommitLevel(siteId: string, tenantId: string): Promise<boolean>;
  
  getGlobalConfig(key: string): Promise<string | null>;
  setGlobalConfig(key: string, value: string): Promise<void>;
  
  getStorageConfigBySite(siteId: string): Promise<SiteStorageConfig[]>;
  upsertStorageConfig(config: InsertSiteStorageConfig): Promise<SiteStorageConfig>;
  deleteStorageConfig(siteId: string, tierName: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getAllPlatformSites(): Promise<PlatformSite[]> {
    return db.select().from(platformSites);
  }

  async getPlatformSite(id: string): Promise<PlatformSite | undefined> {
    const [site] = await db.select().from(platformSites).where(eq(platformSites.id, id));
    return site;
  }

  async getPlatformSiteBySiteId(siteId: string): Promise<PlatformSite | undefined> {
    const [site] = await db.select().from(platformSites).where(eq(platformSites.siteId, siteId));
    return site;
  }

  async createPlatformSite(site: InsertPlatformSite): Promise<PlatformSite> {
    const [created] = await db.insert(platformSites).values(site).returning();
    return created;
  }

  async updatePlatformSite(id: string, site: UpdatePlatformSite): Promise<PlatformSite | undefined> {
    const [updated] = await db
      .update(platformSites)
      .set({ ...site, updatedAt: new Date() })
      .where(eq(platformSites.id, id))
      .returning();
    return updated;
  }

  async deletePlatformSite(id: string): Promise<boolean> {
    const result = await db.delete(platformSites).where(eq(platformSites.id, id));
    return true;
  }

  async getAllCommitLevels(): Promise<TenantCommitLevel[]> {
    return db.select().from(tenantCommitLevels);
  }

  async getCommitLevelsBySite(siteId: string): Promise<TenantCommitLevel[]> {
    return db.select().from(tenantCommitLevels).where(eq(tenantCommitLevels.siteId, siteId));
  }

  async getCommitLevel(siteId: string, tenantId: string): Promise<TenantCommitLevel | undefined> {
    const [level] = await db.select().from(tenantCommitLevels).where(
      and(
        eq(tenantCommitLevels.siteId, siteId),
        eq(tenantCommitLevels.tenantId, tenantId)
      )
    );
    return level;
  }

  async upsertCommitLevel(level: InsertTenantCommitLevel): Promise<TenantCommitLevel> {
    const existing = await this.getCommitLevel(level.siteId, level.tenantId);
    if (existing) {
      const [updated] = await db
        .update(tenantCommitLevels)
        .set({ ...level, updatedAt: new Date() })
        .where(eq(tenantCommitLevels.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(tenantCommitLevels).values(level).returning();
      return created;
    }
  }

  async deleteCommitLevel(siteId: string, tenantId: string): Promise<boolean> {
    await db.delete(tenantCommitLevels).where(
      and(
        eq(tenantCommitLevels.siteId, siteId),
        eq(tenantCommitLevels.tenantId, tenantId)
      )
    );
    return true;
  }

  async getGlobalConfig(key: string): Promise<string | null> {
    const [config] = await db.select().from(globalConfig).where(eq(globalConfig.key, key));
    return config?.value ?? null;
  }

  async setGlobalConfig(key: string, value: string): Promise<void> {
    const [existing] = await db.select().from(globalConfig).where(eq(globalConfig.key, key));
    if (existing) {
      await db.update(globalConfig)
        .set({ value, updatedAt: new Date() })
        .where(eq(globalConfig.key, key));
    } else {
      await db.insert(globalConfig).values({ key, value });
    }
  }

  async getStorageConfigBySite(siteId: string): Promise<SiteStorageConfig[]> {
    return db.select().from(siteStorageConfig).where(eq(siteStorageConfig.siteId, siteId));
  }

  async upsertStorageConfig(config: InsertSiteStorageConfig): Promise<SiteStorageConfig> {
    const [existing] = await db.select().from(siteStorageConfig).where(
      and(
        eq(siteStorageConfig.siteId, config.siteId),
        eq(siteStorageConfig.tierName, config.tierName)
      )
    );
    if (existing) {
      const [updated] = await db
        .update(siteStorageConfig)
        .set({ usableCapacityGB: config.usableCapacityGB, updatedAt: new Date() })
        .where(eq(siteStorageConfig.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(siteStorageConfig).values(config).returning();
      return created;
    }
  }

  async deleteStorageConfig(siteId: string, tierName: string): Promise<boolean> {
    await db.delete(siteStorageConfig).where(
      and(
        eq(siteStorageConfig.siteId, siteId),
        eq(siteStorageConfig.tierName, tierName)
      )
    );
    return true;
  }
}

export const storage = new DatabaseStorage();
