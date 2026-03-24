-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT,
    "currency" TEXT DEFAULT 'USD',
    "timezone" TEXT DEFAULT 'UTC',
    "tenantAccessDefault" BOOLEAN NOT NULL DEFAULT true,
    "notifications" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceAlerts" BOOLEAN NOT NULL DEFAULT true,
    "leaseReminders" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);
