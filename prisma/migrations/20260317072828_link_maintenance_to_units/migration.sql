-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN     "unitId" TEXT;

-- CreateIndex
CREATE INDEX "maintenance_requests_unitId_idx" ON "maintenance_requests"("unitId");

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
