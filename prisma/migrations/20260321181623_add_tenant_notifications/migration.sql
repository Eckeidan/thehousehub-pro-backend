-- CreateTable
CREATE TABLE "TenantNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantNotification_tenantId_idx" ON "TenantNotification"("tenantId");

-- CreateIndex
CREATE INDEX "TenantNotification_isRead_idx" ON "TenantNotification"("isRead");

-- AddForeignKey
ALTER TABLE "TenantNotification" ADD CONSTRAINT "TenantNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
