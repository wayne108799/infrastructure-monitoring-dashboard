import type { Request, Response, NextFunction } from 'express';
import { getUserWithPermissions, hasPermission, hasAnyPermission } from './auth';
import type { User, Group } from '@shared/schema';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      userGroups?: Group[];
      userPermissions?: string[];
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    if (!session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userData = await getUserWithPermissions(session.userId);
    if (!userData) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!userData.user.isActive) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    req.user = userData.user;
    req.userGroups = userData.groups;
    req.userPermissions = userData.permissions;

    if (!hasPermission(userData.permissions, permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

export function requireAnyPermission(permissions: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    if (!session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userData = await getUserWithPermissions(session.userId);
    if (!userData) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!userData.user.isActive) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    req.user = userData.user;
    req.userGroups = userData.groups;
    req.userPermissions = userData.permissions;

    if (!hasAnyPermission(userData.permissions, permissions)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

export async function loadUserContext(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (session?.userId) {
    const userData = await getUserWithPermissions(session.userId);
    if (userData && userData.user.isActive) {
      req.user = userData.user;
      req.userGroups = userData.groups;
      req.userPermissions = userData.permissions;
    }
  }
  next();
}
