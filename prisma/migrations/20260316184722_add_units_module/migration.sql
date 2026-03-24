-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitName" TEXT,
    "floor" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "areaSqm" DECIMAL(10,2),
    "monthlyRent" DECIMAL(12,2),
    "occupancyStatus" TEXT DEFAULT 'AVAILABLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "units_propertyId_idx" ON "units"("propertyId");

-- CreateIndex
CREATE INDEX "units_unitCode_idx" ON "units"("unitCode");

-- CreateIndex
CREATE INDEX "units_occupancyStatus_idx" ON "units"("occupancyStatus");

-- CreateIndex
CREATE INDEX "units_isActive_idx" ON "units"("isActive");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
