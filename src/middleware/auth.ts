import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { AuthPayload, AuthRequest } from '../types';

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded: AuthPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
  } catch {
    res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired token' });
    return;
  }

  try {
    // The token only proves identity. Role and active status are read from the DB on every
    // request, so a role change or deactivation takes effect immediately.
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Unauthorized: Account not found or deactivated' });
      return;
    }

    req.user = { userId: user.id, role: user.role };
    next();
  } catch (err) {
    console.error('Auth lookup failed:', err);
    res.status(500).json({ success: false, error: 'Authentication check failed' });
  }
};

/**
 * Salesmen may only work while checked in (an open attendance record). Other roles pass through,
 * so managers and admins keep using the same routes for support.
 */
export const requireCheckIn = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (req.user?.role !== 'SALESMAN') return next();
  try {
    const open = await prisma.attendance.findUnique({ where: { openKey: req.user.userId }, select: { id: true } });
    if (!open) {
      res.status(403).json({ success: false, error: 'Check in first to use this feature', code: 'NOT_CHECKED_IN' });
      return;
    }
    next();
  } catch (err) {
    console.error('Check-in lookup failed:', err);
    res.status(500).json({ success: false, error: 'Attendance check failed' });
  }
};

export const authorizeRoles =(...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions' });
      return;
    }
    next();
  };
};
