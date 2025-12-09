import { 
  type User, 
  type InsertUser, 
  type PlatformSite, 
  type InsertPlatformSite, 
  type UpdatePlatformSite,
  type TenantCommitLevel,
  type InsertTenantCommitLevel,
  type UpdateTenantCommitLevel,
  users,
  platformSites,
  tenantCommitLevels
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
}

export const storage = new DatabaseStorage();
