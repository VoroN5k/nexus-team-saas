-- CreateEnum
CREATE TYPE "RotationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPIRED', 'DENIED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShareRotationRequest" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "newPublicKey" TEXT NOT NULL,
    "status" "RotationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareRotationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationSubmission" (
    "id" TEXT NOT NULL,
    "rotationRequestId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "share" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RotationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareRotationRequest_vaultId_idx" ON "ShareRotationRequest"("vaultId");

-- CreateIndex
CREATE INDEX "ShareRotationRequest_requesterId_idx" ON "ShareRotationRequest"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationSubmission_rotationRequestId_holderId_key" ON "RotationSubmission"("rotationRequestId", "holderId");

-- AddForeignKey
ALTER TABLE "ShareRotationRequest" ADD CONSTRAINT "ShareRotationRequest_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareRotationRequest" ADD CONSTRAINT "ShareRotationRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSubmission" ADD CONSTRAINT "RotationSubmission_rotationRequestId_fkey" FOREIGN KEY ("rotationRequestId") REFERENCES "ShareRotationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSubmission" ADD CONSTRAINT "RotationSubmission_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
