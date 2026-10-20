import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';

/**
 * Selfies are personal data, so they are stored OUTSIDE the publicly served /uploads folder and are only
 * reachable through authenticated API endpoints (owner or back-office).
 */
export const PRIVATE_UPLOAD_ROOT = path.resolve(__dirname, '../../private-uploads');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png' };

/** Verify the real file content, not just the client-declared type. */
function detectImageType(filePath: string): 'image/jpeg' | 'image/png' | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const userId = (req as AuthRequest).user?.userId || 'unknown';
      const dir = path.join(PRIVATE_UPLOAD_ROOT, 'attendance', userId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    // Real extension is applied after the content check (the client-declared type is unreliable).
    filename: (_req, _file, cb) => cb(null, `${uuidv4()}.upload`),
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Mobile pickers often send image/jpg, image/pjpeg, application/octet-stream or no type at all,
    // so accept those here; the magic-byte check below is what actually enforces JPEG/PNG.
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimeOk = /^image\/(jpe?g|pjpeg|png|x-png)$/i.test(file.mimetype) || file.mimetype === 'application/octet-stream' || !file.mimetype;
    const extOk = ['.jpg', '.jpeg', '.png', ''].includes(ext);
    if (mimeOk && extOk) cb(null, true);
    else cb(new Error('Selfie must be a JPEG or PNG image'));
  },
}).single('selfie');

/** Express middleware: accepts one image in the `selfie` field and rejects anything that isn't really a JPEG/PNG. */
export const selfieUpload = (req: AuthRequest, res: Response, next: NextFunction): void => {
  upload(req as any, res, (err: any) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Selfie must be 5 MB or smaller' : err.message || 'Invalid upload';
      res.status(400).json({ success: false, error: msg });
      return;
    }
    if (req.file) {
      let type: string | null = null;
      try { type = detectImageType(req.file.path); } catch { /* treated as invalid */ }
      if (!type) {
        removeUploaded(req.file.path);
        req.file = undefined;
        res.status(400).json({ success: false, error: 'Selfie must be a valid JPEG or PNG image' });
        return;
      }
      const finalPath = req.file.path.replace(/\.upload$/, EXT_BY_MIME[type]);
      try {
        fs.renameSync(req.file.path, finalPath);
        req.file.path = finalPath;
        req.file.filename = path.basename(finalPath);
        req.file.mimetype = type;
      } catch {
        removeUploaded(req.file.path);
        req.file = undefined;
        res.status(500).json({ success: false, error: 'Failed to store selfie' });
        return;
      }
    }
    next();
  });
};

/** Path stored in the DB is relative to PRIVATE_UPLOAD_ROOT (never an absolute server path). */
export const toStoredPath = (absPath: string): string => path.relative(PRIVATE_UPLOAD_ROOT, absPath).split(path.sep).join('/');

/** Resolve a stored path safely; returns null if it would escape the private root. */
export function resolveStoredPath(stored: string): string | null {
  const abs = path.resolve(PRIVATE_UPLOAD_ROOT, stored);
  return abs.startsWith(PRIVATE_UPLOAD_ROOT + path.sep) ? abs : null;
}

export function removeUploaded(absPath?: string): void {
  if (!absPath) return;
  try { fs.unlinkSync(absPath); } catch { /* already gone */ }
}
