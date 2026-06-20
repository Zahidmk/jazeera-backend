"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.forgotPassword = exports.getMe = exports.login = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../utils/prisma"));
// ─── POST /api/v1/auth/login ─────────────────────────────────────────────────
const login = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        console.log("LOGIN BODY:", req.body);
        if (!password || (!email && !phone)) {
            res.status(400).json({ success: false, error: 'Email or phone and password are required' });
            return;
        }
        const user = await prisma_1.default.user.findFirst({
            where: {
                isActive: true,
                OR: [
                    { email: email ?? undefined },
                    { phone: phone ?? undefined },
                ],
            },
            include: { van: { select: { id: true, plateNumber: true } } },
        });
        console.log("USER FOUND:", !!user);
        if (!user) {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
            return;
        }
        const passwordMatch = await bcryptjs_1.default.compare(password, user.passwordHash);
        console.log("PASSWORD MATCH:", passwordMatch);
        if (!passwordMatch) {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    van: user.van,
                },
            },
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
};
exports.login = login;
// ─── GET /api/v1/auth/me ─────────────────────────────────────────────────────
const getMe = async (req, res) => {
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: req.user.userId },
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
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to get user' });
    }
};
exports.getMe = getMe;
// ─── POST /api/v1/auth/forgot-password ───────────────────────────────────────
const forgotPassword = async (req, res) => {
    try {
        const { email, phone } = req.body;
        const user = await prisma_1.default.user.findFirst({
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
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Request failed' });
    }
};
exports.forgotPassword = forgotPassword;
//# sourceMappingURL=auth.controller.js.map