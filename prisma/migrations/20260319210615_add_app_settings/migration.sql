-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT 'PropertyOS Inc.',
    "email" TEXT NOT NULL DEFAULT 'admin@propertyos.com',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "tenantAccessDefault" BOOLEAN NOT NULL DEFAULT true,
    "notifications" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceAlerts" BOOLEAN NOT NULL DEFAULT true,
    "leaseReminders" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);
