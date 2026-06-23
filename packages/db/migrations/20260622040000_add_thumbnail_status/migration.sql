-- CreateEnum
CREATE TYPE "ThumbnailStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "MediaFile" ADD COLUMN "thumbnailKey" TEXT,
ADD COLUMN "thumbnailStatus" "ThumbnailStatus" NOT NULL DEFAULT 'PENDING';
