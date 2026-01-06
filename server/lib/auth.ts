import bcrypt from 'bcrypt';
import { storage } from '../storage';
import type { User, Group } from '@shared/schema';
import { PERMISSIONS } from '@shared/schema';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createUser(
  username: string,
  password: string,
  options?: { email?: string; displayName?: string }
): Promise<User> {
  const hashedPassword = await hashPassword(password);
  return storage.createUser({
    username,
    password: hashedPassword,
    email: options?.email,
    displayName: options?.displayName,
    isActive: true,
  });
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const user = await storage.getUserByUsername(username);
  if (!user || !user.isActive) return null;
  
  const isValid = await verifyPassword(password, user.password);
  if (!isValid) return null;
  
  await storage.updateUserLastLogin(user.id);
  return user;
}

export async function getUserWithPermissions(userId: string): Promise<{
  user: User;
  groups: Group[];
  permissions: string[];
} | null> {
  const user = await storage.getUser(userId);
  if (!user) return null;
  
  const groups = await storage.getUserGroups(userId);
  const permissions = await storage.getUserPermissions(userId);
  
  return { user, groups, permissions };
}

export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  return userPermissions.includes(requiredPermission);
}

export function hasAnyPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.some(p => userPermissions.includes(p));
}

export function hasAllPermissions(userPermissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.every(p => userPermissions.includes(p));
}

export async function initializeDefaultGroups(): Promise<void> {
  const existingAdmin = await storage.getGroupByName('Administrators');
  if (existingAdmin) return;

  await storage.createGroup({
    name: 'Administrators',
    description: 'Full system access',
    permissions: Object.values(PERMISSIONS),
  });

  await storage.createGroup({
    name: 'Operators',
    description: 'Can view and manage resources but not users',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD,
      PERMISSIONS.VIEW_DETAILS,
      PERMISSIONS.VIEW_REPORTS,
      PERMISSIONS.MANAGE_COMMITS,
      PERMISSIONS.TRIGGER_POLLING,
    ],
  });

  await storage.createGroup({
    name: 'Viewers',
    description: 'Read-only access',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD,
      PERMISSIONS.VIEW_DETAILS,
      PERMISSIONS.VIEW_REPORTS,
    ],
  });
}

export async function initializeDefaultAdmin(): Promise<User | null> {
  const users = await storage.getAllUsers();
  if (users.length > 0) return null;

  const adminUser = await createUser('admin', 'admin', {
    displayName: 'Administrator',
  });

  const adminGroup = await storage.getGroupByName('Administrators');
  if (adminGroup) {
    await storage.addUserToGroup(adminUser.id, adminGroup.id);
  }

  return adminUser;
}

export { PERMISSIONS };
