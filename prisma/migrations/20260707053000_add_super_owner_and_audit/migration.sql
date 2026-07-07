ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_OWNER';

CREATE TABLE "SystemAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "actorRole" "UserRole",
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemAuditLog_actorUserId_idx" ON "SystemAuditLog"("actorUserId");
CREATE INDEX "SystemAuditLog_actorRole_idx" ON "SystemAuditLog"("actorRole");
CREATE INDEX "SystemAuditLog_organizationId_idx" ON "SystemAuditLog"("organizationId");
CREATE INDEX "SystemAuditLog_action_idx" ON "SystemAuditLog"("action");
CREATE INDEX "SystemAuditLog_resource_idx" ON "SystemAuditLog"("resource");
CREATE INDEX "SystemAuditLog_statusCode_idx" ON "SystemAuditLog"("statusCode");
CREATE INDEX "SystemAuditLog_createdAt_idx" ON "SystemAuditLog"("createdAt");

ALTER TABLE "SystemAuditLog"
ADD CONSTRAINT "SystemAuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SystemAuditLog"
ADD CONSTRAINT "SystemAuditLog_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
