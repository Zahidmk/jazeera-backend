-- Catch-up migration: these columns already exist in prisma/schema.prisma (and likely in any database that was
-- created with `prisma db push`) but no earlier migration created them, so a database built purely from the
-- migration history was missing them. Every statement is idempotent (IF NOT EXISTS) and additive only.

-- AlterTable
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "buildingNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "street" TEXT,
  ADD COLUMN IF NOT EXISTS "zip" TEXT;

-- AlterTable
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "buildingNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "street" TEXT,
  ADD COLUMN IF NOT EXISTS "zip" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "odooEmployeeId" INTEGER;
