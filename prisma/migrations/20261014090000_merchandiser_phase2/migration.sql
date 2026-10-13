-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('STOCK', 'DISPLAY', 'PRICING', 'COMPETITOR', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWED', 'RESOLVED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "shopType" TEXT;

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "merchandiserId" TEXT NOT NULL,
    "openKey" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInDeviceTime" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION NOT NULL,
    "checkInLng" DOUBLE PRECISION NOT NULL,
    "checkInAccuracy" DOUBLE PRECISION,
    "checkInSelfie" TEXT NOT NULL,
    "checkInDeviceId" TEXT NOT NULL,
    "checkInBiometric" BOOLEAN NOT NULL,
    "checkInBiometricMethod" TEXT,
    "checkOutAt" TIMESTAMP(3),
    "checkOutDeviceTime" TIMESTAMP(3),
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "checkOutAccuracy" DOUBLE PRECISION,
    "checkOutSelfie" TEXT,
    "checkOutDeviceId" TEXT,
    "checkOutBiometric" BOOLEAN,
    "checkOutBiometricMethod" TEXT,
    "closedByAdminId" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopVisit" (
    "id" TEXT NOT NULL,
    "merchandiserId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "openKey" TEXT,
    "status" "VisitStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startLat" DOUBLE PRECISION NOT NULL,
    "startLng" DOUBLE PRECISION NOT NULL,
    "startDistanceM" DOUBLE PRECISION,
    "outOfRange" BOOLEAN NOT NULL DEFAULT false,
    "endedAt" TIMESTAMP(3),
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "ShopVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopFeedback" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "merchandiserId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL DEFAULT 'OTHER',
    "rating" INTEGER,
    "comments" TEXT NOT NULL,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_userId_deviceId_key" ON "UserDevice"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_openKey_key" ON "Attendance"("openKey");

-- CreateIndex
CREATE INDEX "Attendance_merchandiserId_checkInAt_idx" ON "Attendance"("merchandiserId", "checkInAt");

-- CreateIndex
CREATE INDEX "Attendance_checkInAt_idx" ON "Attendance"("checkInAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopVisit_openKey_key" ON "ShopVisit"("openKey");

-- CreateIndex
CREATE INDEX "ShopVisit_merchandiserId_startedAt_idx" ON "ShopVisit"("merchandiserId", "startedAt");

-- CreateIndex
CREATE INDEX "ShopVisit_customerId_startedAt_idx" ON "ShopVisit"("customerId", "startedAt");

-- CreateIndex
CREATE INDEX "ShopFeedback_status_createdAt_idx" ON "ShopFeedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ShopFeedback_customerId_idx" ON "ShopFeedback"("customerId");

-- CreateIndex
CREATE INDEX "Customer_createdById_idx" ON "Customer"("createdById");

-- CreateIndex
CREATE INDEX "Customer_lat_lng_idx" ON "Customer"("lat", "lng");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_merchandiserId_fkey" FOREIGN KEY ("merchandiserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopVisit" ADD CONSTRAINT "ShopVisit_merchandiserId_fkey" FOREIGN KEY ("merchandiserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopVisit" ADD CONSTRAINT "ShopVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopVisit" ADD CONSTRAINT "ShopVisit_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFeedback" ADD CONSTRAINT "ShopFeedback_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "ShopVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFeedback" ADD CONSTRAINT "ShopFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFeedback" ADD CONSTRAINT "ShopFeedback_merchandiserId_fkey" FOREIGN KEY ("merchandiserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

