import { 
  type User, 
  type InsertUser, 
  type PlatformSite, 
  type InsertPlatformSite, 
  type UpdatePlatformSite,
  users,
  platformSites 
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
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
}

export const storage = new DatabaseStorage();
