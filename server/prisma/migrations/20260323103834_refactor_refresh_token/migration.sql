/*
  Warnings:

  - You are about to drop the column `token` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the `RefreshToken` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[refreshToken]` on the table `Session` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `expiresAt` to the `Session` table without a default value. This is not possible if the table is not empty.
  - Added the required column `refreshToken` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropIndex
DROP INDEX "Session_token_key";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "token",
DROP COLUMN "updatedAt",
ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "refreshToken" TEXT NOT NULL,
ADD COLUMN     "userAgent" TEXT;

-- DropTable
DROP TABLE "RefreshToken";

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshToken_key" ON "Session"("refreshToken");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
