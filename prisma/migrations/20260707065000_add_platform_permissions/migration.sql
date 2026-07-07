ALTER TABLE "User"
ADD COLUMN "platformAccessAll" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "platformPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "User_platformAccessAll_idx" ON "User"("platformAccessAll");

UPDATE "User"
SET "platformAccessAll" = true
WHERE "role" = 'SUPER_OWNER';
