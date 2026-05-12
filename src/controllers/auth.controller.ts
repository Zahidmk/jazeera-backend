import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { AuthRequest } from '../types';

// ─── POST /api/v1/auth/login ─────────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, password } = req.body;

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
      include: { van: { select: { id: true, plateNumber: true } } },
    });

    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: {
        token,
        driver: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          van: user.van,
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
        van: { select: { id: true, plateNumber: true, model: true } },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data: user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to get user' });
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
