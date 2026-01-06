import type { Express, Request, Response } from 'express';
import { storage } from './storage';
import { 
  authenticateUser, 
  createUser, 
  getUserWithPermissions,
  hashPassword,
  initializeDefaultGroups,
  initializeDefaultAdmin,
  PERMISSIONS 
} from './lib/auth';
import { requirePermission, loadUserContext } from './lib/authMiddleware';
import { z } from 'zod';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  email: z.string().email().optional(),
  displayName: z.string().optional(),
});

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  email: z.string().email().optional().nullable(),
  displayName: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  groupIds: z.array(z.string()).optional(),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(6).optional(),
  email: z.string().email().optional().nullable(),
  displayName: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  groupIds: z.array(z.string()).optional(),
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  permissions: z.array(z.string()).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  permissions: z.array(z.string()).optional(),
});

export async function registerAuthRoutes(app: Express): Promise<void> {
  await initializeDefaultGroups();
  const defaultAdmin = await initializeDefaultAdmin();
  if (defaultAdmin) {
    console.log('[auth] Created default admin user. Username: admin, Password: admin (change immediately!)');
  }

  app.use(loadUserContext);

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      const user = await authenticateUser(parsed.data.username, parsed.data.password);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const session = (req as any).session;
      session.userId = user.id;

      const userData = await getUserWithPermissions(user.id);
      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
        },
        permissions: userData?.permissions || [],
        groups: userData?.groups.map(g => ({ id: g.id, name: g.name })) || [],
      });
    } catch (error: any) {
      console.error('[auth] Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const session = (req as any).session;
    session.destroy((err: any) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to logout' });
      }
      res.json({ success: true });
    });
  });

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const session = (req as any).session;
    if (!session?.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userData = await getUserWithPermissions(session.userId);
    if (!userData) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: userData.user.id,
        username: userData.user.username,
        email: userData.user.email,
        displayName: userData.user.displayName,
      },
      permissions: userData.permissions,
      groups: userData.groups.map(g => ({ id: g.id, name: g.name })),
    });
  });

  app.get('/api/auth/permissions', (req: Request, res: Response) => {
    res.json(Object.values(PERMISSIONS));
  });

  app.get('/api/users', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const usersWithGroups = await Promise.all(
        users.map(async (user) => {
          const groups = await storage.getUserGroups(user.id);
          return {
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            isActive: user.isActive,
            lastLoginAt: user.lastLoginAt,
            createdAt: user.createdAt,
            groups: groups.map(g => ({ id: g.id, name: g.name })),
          };
        })
      );
      res.json(usersWithGroups);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/users', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const existing = await storage.getUserByUsername(parsed.data.username);
      if (existing) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      const user = await createUser(parsed.data.username, parsed.data.password, {
        email: parsed.data.email || undefined,
        displayName: parsed.data.displayName || undefined,
      });

      if (parsed.data.groupIds) {
        for (const groupId of parsed.data.groupIds) {
          await storage.addUserToGroup(user.id, groupId);
        }
      }

      const groups = await storage.getUserGroups(user.id);
      res.status(201).json({
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        isActive: user.isActive,
        groups: groups.map(g => ({ id: g.id, name: g.name })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/users/:id', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const existing = await storage.getUser(id);
      if (!existing) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updates: any = {};
      if (parsed.data.username) updates.username = parsed.data.username;
      if (parsed.data.email !== undefined) updates.email = parsed.data.email;
      if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;
      if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
      if (parsed.data.password) updates.password = await hashPassword(parsed.data.password);

      const updated = await storage.updateUser(id, updates);

      if (parsed.data.groupIds !== undefined) {
        const currentGroups = await storage.getUserGroups(id);
        for (const group of currentGroups) {
          await storage.removeUserFromGroup(id, group.id);
        }
        for (const groupId of parsed.data.groupIds) {
          await storage.addUserToGroup(id, groupId);
        }
      }

      const groups = await storage.getUserGroups(id);
      res.json({
        id: updated?.id,
        username: updated?.username,
        email: updated?.email,
        displayName: updated?.displayName,
        isActive: updated?.isActive,
        groups: groups.map(g => ({ id: g.id, name: g.name })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/users/:id', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = (req as any).session;
      
      if (session.userId === id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }

      await storage.deleteUser(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/groups', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const groups = await storage.getAllGroups();
      res.json(groups.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        permissions: g.permissions,
        createdAt: g.createdAt,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/groups', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const parsed = createGroupSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const existing = await storage.getGroupByName(parsed.data.name);
      if (existing) {
        return res.status(409).json({ error: 'Group name already exists' });
      }

      const group = await storage.createGroup({
        name: parsed.data.name,
        description: parsed.data.description,
        permissions: parsed.data.permissions || [],
      });

      res.status(201).json({
        id: group.id,
        name: group.name,
        description: group.description,
        permissions: group.permissions,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/groups/:id', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const parsed = updateGroupSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
      }

      const existing = await storage.getGroup(id);
      if (!existing) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const updated = await storage.updateGroup(id, {
        name: parsed.data.name,
        description: parsed.data.description,
        permissions: parsed.data.permissions,
      });

      res.json({
        id: updated?.id,
        name: updated?.name,
        description: updated?.description,
        permissions: updated?.permissions,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/groups/:id', requirePermission(PERMISSIONS.MANAGE_USERS), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const group = await storage.getGroup(id);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      if (group.name === 'Administrators') {
        return res.status(400).json({ error: 'Cannot delete the Administrators group' });
      }

      await storage.deleteGroup(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
