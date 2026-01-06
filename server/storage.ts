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
  type Group,
  type InsertGroup,
  type UserGroup,
  type InsertUserGroup,
  type SiteMonitorStatus,
  type InsertSiteMonitorStatus,
  users,
  platformSites,
  tenantCommitLevels,
  globalConfig,
  siteStorageConfig,
  groups,
  userGroups,
  siteMonitorStatus
} from "@shared/schema";
import { db } from "./db";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  updateUserLastLogin(id: string): Promise<void>;
  
  getGroup(id: string): Promise<Group | undefined>;
  getGroupByName(name: string): Promise<Group | undefined>;
  getAllGroups(): Promise<Group[]>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroup(id: string, updates: Partial<InsertGroup>): Promise<Group | undefined>;
  deleteGroup(id: string): Promise<boolean>;
  
  getUserGroups(userId: string): Promise<Group[]>;
  addUserToGroup(userId: string, groupId: string): Promise<UserGroup>;
  removeUserFromGroup(userId: string, groupId: string): Promise<boolean>;
  getUserPermissions(userId: string): Promise<string[]>;
  
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
  
  getMonitorStatus(siteId: string): Promise<SiteMonitorStatus | undefined>;
  getAllMonitorStatuses(): Promise<SiteMonitorStatus[]>;
  upsertMonitorStatus(status: InsertSiteMonitorStatus): Promise<SiteMonitorStatus>;
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

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    await db.delete(users).where(eq(users.id, id));
    return true;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async getGroupByName(name: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.name, name));
    return group;
  }

  async getAllGroups(): Promise<Group[]> {
    return db.select().from(groups);
  }

  async createGroup(group: InsertGroup): Promise<Group> {
    const [created] = await db.insert(groups).values({
      name: group.name,
      description: group.description,
      permissions: group.permissions ? JSON.stringify(group.permissions) : '[]',
    } as any).returning();
    return created;
  }

  async updateGroup(id: string, updates: Partial<InsertGroup>): Promise<Group | undefined> {
    const updateData: any = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.permissions !== undefined) updateData.permissions = JSON.stringify(updates.permissions);
    
    const [updated] = await db
      .update(groups)
      .set(updateData)
      .where(eq(groups.id, id))
      .returning();
    return updated;
  }

  async deleteGroup(id: string): Promise<boolean> {
    await db.delete(groups).where(eq(groups.id, id));
    return true;
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    const memberships = await db.select().from(userGroups).where(eq(userGroups.userId, userId));
    if (memberships.length === 0) return [];
    const groupIds = memberships.map(m => m.groupId);
    return db.select().from(groups).where(inArray(groups.id, groupIds));
  }

  async addUserToGroup(userId: string, groupId: string): Promise<UserGroup> {
    const [existing] = await db.select().from(userGroups).where(
      and(eq(userGroups.userId, userId), eq(userGroups.groupId, groupId))
    );
    if (existing) return existing;
    const [created] = await db.insert(userGroups).values({ userId, groupId }).returning();
    return created;
  }

  async removeUserFromGroup(userId: string, groupId: string): Promise<boolean> {
    await db.delete(userGroups).where(
      and(eq(userGroups.userId, userId), eq(userGroups.groupId, groupId))
    );
    return true;
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    const userGroupsList = await this.getUserGroups(userId);
    const allPermissions = new Set<string>();
    for (const group of userGroupsList) {
      const perms = group.permissions as string[] | null;
      if (perms) {
        perms.forEach(p => allPermissions.add(p));
      }
    }
    return Array.from(allPermissions);
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

  async getMonitorStatus(siteId: string): Promise<SiteMonitorStatus | undefined> {
    const [status] = await db.select().from(siteMonitorStatus).where(eq(siteMonitorStatus.siteId, siteId));
    return status;
  }

  async getAllMonitorStatuses(): Promise<SiteMonitorStatus[]> {
    return db.select().from(siteMonitorStatus);
  }

  async upsertMonitorStatus(status: InsertSiteMonitorStatus): Promise<SiteMonitorStatus> {
    const existing = await this.getMonitorStatus(status.siteId);
    
    if (existing) {
      const [updated] = await db
        .update(siteMonitorStatus)
        .set({ ...status, updatedAt: new Date() })
        .where(eq(siteMonitorStatus.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(siteMonitorStatus).values(status).returning();
      return created;
    }
  }
}

export const storage = new DatabaseStorage();
