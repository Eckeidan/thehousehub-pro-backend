/*
  Warnings:

  - You are about to drop the column `estimatedCost` on the `maintenance_requests` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "maintenance_requests" DROP COLUMN "estimatedCost",
ADD COLUMN     "estimatedLaborCost" DECIMAL(12,2),
ADD COLUMN     "estimatedMaterialsCost" DECIMAL(12,2),
ADD COLUMN     "estimatedTotalCost" DECIMAL(12,2),
ADD COLUMN     "materialsNotes" TEXT;
