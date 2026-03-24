/*
  Warnings:

  - You are about to drop the `TenantNotification` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TenantNotification" DROP CONSTRAINT "TenantNotification_tenantId_fkey";

-- DropTable
DROP TABLE "TenantNotification";
