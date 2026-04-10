-- CreateEnum
CREATE TYPE "LeaseChangeType" AS ENUM ('RENT_CHANGE');

-- CreateEnum
CREATE TYPE "LeaseChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN     "address" TEXT,
ADD COLUMN     "baseFee" DECIMAL(12,2),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "hourlyRate" DECIMAL(12,2),
ADD COLUMN     "serviceCategory" TEXT;

-- CreateTable
CREATE TABLE "lease_change_requests" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "changeType" "LeaseChangeType" NOT NULL DEFAULT 'RENT_CHANGE',
    "status" "LeaseChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "oldRentAmount" DOUBLE PRECISION NOT NULL,
    "newRentAmount" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "reason" TEXT,
    "tenantComment" TEXT,
    "respondedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lease_change_requests_leaseId_idx" ON "lease_change_requests"("leaseId");

-- CreateIndex
CREATE INDEX "lease_change_requests_tenantId_idx" ON "lease_change_requests"("tenantId");

-- CreateIndex
CREATE INDEX "lease_change_requests_unitId_idx" ON "lease_change_requests"("unitId");

-- CreateIndex
CREATE INDEX "lease_change_requests_propertyId_idx" ON "lease_change_requests"("propertyId");

-- CreateIndex
CREATE INDEX "lease_change_requests_status_idx" ON "lease_change_requests"("status");

-- CreateIndex
CREATE INDEX "lease_change_requests_changeType_idx" ON "lease_change_requests"("changeType");

-- CreateIndex
CREATE INDEX "lease_change_requests_requestedByUserId_idx" ON "lease_change_requests"("requestedByUserId");

-- CreateIndex
CREATE INDEX "Contractor_serviceCategory_idx" ON "Contractor"("serviceCategory");

-- CreateIndex
CREATE INDEX "Contractor_city_idx" ON "Contractor"("city");

-- AddForeignKey
ALTER TABLE "lease_change_requests" ADD CONSTRAINT "lease_change_requests_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_change_requests" ADD CONSTRAINT "lease_change_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_change_requests" ADD CONSTRAINT "lease_change_requests_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_change_requests" ADD CONSTRAINT "lease_change_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_change_requests" ADD CONSTRAINT "lease_change_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
