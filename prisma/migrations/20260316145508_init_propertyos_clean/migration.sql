-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOUSE', 'DUPLEX', 'COMMERCIAL', 'LAND', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('ACTIVE', 'PENDING', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'HVAC', 'LOCKS', 'PAINTING', 'PEST_CONTROL', 'APPLIANCE', 'GENERAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'FAILED', 'WAIVED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MAINTENANCE', 'UTILITIES', 'TAX', 'INSURANCE', 'MANAGEMENT', 'LEGAL', 'CLEANING', 'MARKETING', 'MORTGAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('RENT', 'LATE_FEE', 'PARKING', 'LAUNDRY', 'PET_FEE', 'STORAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('LEASE', 'INVOICE', 'RECEIPT', 'INSPECTION', 'IDENTITY', 'MOVE_IN_CHECKLIST', 'NOTICE', 'PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('EMAIL', 'SMS', 'CALL', 'NOTE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('LEAD', 'ANALYZING', 'OFFER_MADE', 'UNDER_CONTRACT', 'WON', 'LOST', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "AIRecommendationType" AS ENUM ('MAINTENANCE_TRIAGE', 'CONTRACTOR_SUGGESTION', 'EXPENSE_CATEGORIZATION', 'TENANT_MESSAGE', 'LEASE_RENEWAL', 'FINANCIAL_INSIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "AIOwnerDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MODIFIED');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'APARTMENT',
    "unitsCount" INTEGER NOT NULL DEFAULT 1,
    "purchasePrice" DECIMAL(12,2),
    "currentValue" DECIMAL(12,2),
    "monthlyRent" DECIMAL(12,2),
    "description" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "areaSqm" DECIMAL(10,2),
    "floor" INTEGER,
    "furnishingStatus" TEXT,
    "parkingSpaces" INTEGER DEFAULT 0,
    "availableFrom" TIMESTAMP(3),
    "ownerName" TEXT,
    "occupancyStatus" TEXT DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "leaseStartDate" TIMESTAMP(3),
    "leaseEndDate" TIMESTAMP(3),
    "monthlyRent" DECIMAL(12,2),
    "depositAmount" DECIMAL(12,2),
    "leaseStatus" "LeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT,
    "contractorId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "MaintenanceCategory" NOT NULL DEFAULT 'GENERAL',
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "locationNote" TEXT,
    "assignedTo" TEXT,
    "preferredDate" TIMESTAMP(3),
    "entryPermission" BOOLEAN NOT NULL DEFAULT false,
    "estimatedCost" DECIMAL(12,2),
    "actualCost" DECIMAL(12,2),
    "adminNotes" TEXT,
    "photos" JSONB,
    "dueDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "specialties" TEXT,
    "rating" DECIMAL(3,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentPayment" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amountDue" DECIMAL(12,2),
    "amountPaid" DECIMAL(12,2) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taxDeductible" BOOLEAN NOT NULL DEFAULT false,
    "vendorName" TEXT,
    "receiptUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "title" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "incomeType" "IncomeType" NOT NULL DEFAULT 'OTHER',
    "incomeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "tenantId" TEXT,
    "documentName" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "accessibleToTenant" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "tenantId" TEXT,
    "type" "CommunicationType" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "subject" TEXT,
    "messageSummary" TEXT NOT NULL,
    "relatedTo" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderName" TEXT,
    "receiverName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "marketName" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "medianHomePrice" DECIMAL(12,2),
    "populationGrowth" DECIMAL(6,2),
    "medianRent" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealPipeline" (
    "id" TEXT NOT NULL,
    "marketId" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "status" "DealStatus" NOT NULL DEFAULT 'LEAD',
    "listPrice" DECIMAL(12,2),
    "estimatedRent" DECIMAL(12,2),
    "quickScreenResult" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRecommendation" (
    "id" TEXT NOT NULL,
    "type" "AIRecommendationType" NOT NULL,
    "ownerDecision" "AIOwnerDecision" NOT NULL DEFAULT 'PENDING',
    "confidenceScore" DECIMAL(5,2),
    "aiSuggestion" JSONB NOT NULL,
    "reasoning" TEXT,
    "executedAt" TIMESTAMP(3),
    "maintenanceRequestId" TEXT,
    "expenseId" TEXT,
    "dealPipelineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyImage" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Property_code_key" ON "Property"("code");

-- CreateIndex
CREATE INDEX "Property_code_idx" ON "Property"("code");

-- CreateIndex
CREATE INDEX "Property_city_idx" ON "Property"("city");

-- CreateIndex
CREATE INDEX "Property_propertyType_idx" ON "Property"("propertyType");

-- CreateIndex
CREATE INDEX "Property_isActive_idx" ON "Property"("isActive");

-- CreateIndex
CREATE INDEX "Tenant_propertyId_idx" ON "Tenant"("propertyId");

-- CreateIndex
CREATE INDEX "Tenant_email_idx" ON "Tenant"("email");

-- CreateIndex
CREATE INDEX "Tenant_phone_idx" ON "Tenant"("phone");

-- CreateIndex
CREATE INDEX "Tenant_leaseStatus_idx" ON "Tenant"("leaseStatus");

-- CreateIndex
CREATE INDEX "Tenant_isActive_idx" ON "Tenant"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_requestNumber_key" ON "maintenance_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "maintenance_requests_propertyId_idx" ON "maintenance_requests"("propertyId");

-- CreateIndex
CREATE INDEX "maintenance_requests_tenantId_idx" ON "maintenance_requests"("tenantId");

-- CreateIndex
CREATE INDEX "maintenance_requests_contractorId_idx" ON "maintenance_requests"("contractorId");

-- CreateIndex
CREATE INDEX "maintenance_requests_status_idx" ON "maintenance_requests"("status");

-- CreateIndex
CREATE INDEX "maintenance_requests_priority_idx" ON "maintenance_requests"("priority");

-- CreateIndex
CREATE INDEX "maintenance_requests_category_idx" ON "maintenance_requests"("category");

-- CreateIndex
CREATE INDEX "maintenance_requests_dueDate_idx" ON "maintenance_requests"("dueDate");

-- CreateIndex
CREATE INDEX "Contractor_companyName_idx" ON "Contractor"("companyName");

-- CreateIndex
CREATE INDEX "Contractor_phone_idx" ON "Contractor"("phone");

-- CreateIndex
CREATE INDEX "Contractor_isActive_idx" ON "Contractor"("isActive");

-- CreateIndex
CREATE INDEX "RentPayment_propertyId_idx" ON "RentPayment"("propertyId");

-- CreateIndex
CREATE INDEX "RentPayment_tenantId_idx" ON "RentPayment"("tenantId");

-- CreateIndex
CREATE INDEX "RentPayment_status_idx" ON "RentPayment"("status");

-- CreateIndex
CREATE INDEX "RentPayment_dueDate_idx" ON "RentPayment"("dueDate");

-- CreateIndex
CREATE INDEX "RentPayment_paymentDate_idx" ON "RentPayment"("paymentDate");

-- CreateIndex
CREATE INDEX "Expense_propertyId_idx" ON "Expense"("propertyId");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

-- CreateIndex
CREATE INDEX "Expense_taxDeductible_idx" ON "Expense"("taxDeductible");

-- CreateIndex
CREATE INDEX "Income_propertyId_idx" ON "Income"("propertyId");

-- CreateIndex
CREATE INDEX "Income_incomeType_idx" ON "Income"("incomeType");

-- CreateIndex
CREATE INDEX "Income_incomeDate_idx" ON "Income"("incomeDate");

-- CreateIndex
CREATE INDEX "Document_propertyId_idx" ON "Document"("propertyId");

-- CreateIndex
CREATE INDEX "Document_tenantId_idx" ON "Document"("tenantId");

-- CreateIndex
CREATE INDEX "Document_type_idx" ON "Document"("type");

-- CreateIndex
CREATE INDEX "Document_accessibleToTenant_idx" ON "Document"("accessibleToTenant");

-- CreateIndex
CREATE INDEX "Communication_propertyId_idx" ON "Communication"("propertyId");

-- CreateIndex
CREATE INDEX "Communication_tenantId_idx" ON "Communication"("tenantId");

-- CreateIndex
CREATE INDEX "Communication_type_idx" ON "Communication"("type");

-- CreateIndex
CREATE INDEX "Communication_direction_idx" ON "Communication"("direction");

-- CreateIndex
CREATE INDEX "Communication_sentAt_idx" ON "Communication"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Market_marketName_key" ON "Market"("marketName");

-- CreateIndex
CREATE INDEX "Market_marketName_idx" ON "Market"("marketName");

-- CreateIndex
CREATE INDEX "DealPipeline_marketId_idx" ON "DealPipeline"("marketId");

-- CreateIndex
CREATE INDEX "DealPipeline_status_idx" ON "DealPipeline"("status");

-- CreateIndex
CREATE INDEX "DealPipeline_city_idx" ON "DealPipeline"("city");

-- CreateIndex
CREATE INDEX "AIRecommendation_type_idx" ON "AIRecommendation"("type");

-- CreateIndex
CREATE INDEX "AIRecommendation_ownerDecision_idx" ON "AIRecommendation"("ownerDecision");

-- CreateIndex
CREATE INDEX "AIRecommendation_maintenanceRequestId_idx" ON "AIRecommendation"("maintenanceRequestId");

-- CreateIndex
CREATE INDEX "AIRecommendation_expenseId_idx" ON "AIRecommendation"("expenseId");

-- CreateIndex
CREATE INDEX "AIRecommendation_dealPipelineId_idx" ON "AIRecommendation"("dealPipelineId");

-- CreateIndex
CREATE INDEX "PropertyImage_propertyId_idx" ON "PropertyImage"("propertyId");

-- CreateIndex
CREATE INDEX "PropertyImage_isPrimary_idx" ON "PropertyImage"("isPrimary");

-- CreateIndex
CREATE INDEX "PropertyImage_sortOrder_idx" ON "PropertyImage"("sortOrder");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentPayment" ADD CONSTRAINT "RentPayment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentPayment" ADD CONSTRAINT "RentPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealPipeline" ADD CONSTRAINT "DealPipeline_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIRecommendation" ADD CONSTRAINT "AIRecommendation_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIRecommendation" ADD CONSTRAINT "AIRecommendation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIRecommendation" ADD CONSTRAINT "AIRecommendation_dealPipelineId_fkey" FOREIGN KEY ("dealPipelineId") REFERENCES "DealPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyImage" ADD CONSTRAINT "PropertyImage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
