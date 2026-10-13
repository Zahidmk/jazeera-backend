-- AlterEnum
-- Additive only: adds a new Role value, no existing rows or columns are touched.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MERCHANDISER';
