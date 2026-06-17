-- CreateEnum
CREATE TYPE "LoadStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "StockLoadQueue" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" "LoadStatus" NOT NULL DEFAULT 'PENDING';
