-- Support property-level leases after removing unit assignment from the core tenant flow.
ALTER TABLE "Lease" ALTER COLUMN "unitId" DROP NOT NULL;
