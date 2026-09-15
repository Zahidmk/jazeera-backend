import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';

// ─── POST /api/v1/auth/login ─────────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, password } = req.body;
    console.log("LOGIN BODY:", req.body);

    if (!password || (!email && !phone)) {
      res.status(400).json({ success: false, error: 'Email or phone and password are required' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { email: email ?? undefined },
          { phone: phone ?? undefined },
        ],
      },
      include: { 
        van: { select: { id: true, plateNumber: true } },
        shifts: {
          where: { status: 'ACTIVE' },
          take: 1
        }
      },
    });
    console.log("USER FOUND:", !!user);

    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    console.log("PASSWORD MATCH:", passwordMatch);
    if (!passwordMatch) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    const isShiftStarted = user.shifts && user.shifts.length > 0;

    res.json({
      success: true,
      data: {
        token,
        isShiftStarted,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          van: user.van,
          isShiftStarted,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
};

// ─── GET /api/v1/auth/me ─────────────────────────────────────────────────────
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        van: { select: { id: true, plateNumber: true, model: true } },
        shifts: {
          where: { status: 'ACTIVE' },
          take: 1
        }
      },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const { shifts, ...userData } = user;
    const isShiftStarted = shifts && shifts.length > 0;

    res.json({ success: true, data: { ...userData, isShiftStarted } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
};

// ─── PATCH /api/v1/auth/me ────────────────────────────────────────────────────
export const updateMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, phone, currentPassword, newPassword } = req.body;
    const userId = req.user!.userId;

    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!String(name).trim()) {
        res.status(400).json({ success: false, error: 'Name cannot be empty' });
        return;
      }
      data.name = String(name).trim();
    }
    if (email !== undefined) data.email = String(email).trim().toLowerCase();
    if (phone !== undefined) data.phone = phone ? String(phone).trim() : null;

    if (newPassword) {
      if (!currentPassword) {
        res.status(400).json({ success: false, error: 'Current password is required to set a new password' });
        return;
      }
      const existing = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
      if (!existing || !(await bcrypt.compare(currentPassword, existing.passwordHash))) {
        res.status(401).json({ success: false, error: 'Current password is incorrect' });
        return;
      }
      if (String(newPassword).length < 8) {
        res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
        return;
      }
      data.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    });

    res.json({ success: true, data: user });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, error: 'Email or phone already in use' });
    } else {
      console.error(err);
      res.status(500).json({ success: false, error: 'Failed to update profile' });
    }
  }
};

// ─── POST /api/v1/auth/forgot-password ───────────────────────────────────────
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { email: email ?? undefined },
          { phone: phone ?? undefined },
        ],
      },
    });

    // Always return success to avoid user enumeration
    res.json({
      success: true,
      message: user
        ? 'Password reset instructions sent. Please contact your manager.'
        : 'If account exists, instructions will be sent.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Request failed' });
  }
};
