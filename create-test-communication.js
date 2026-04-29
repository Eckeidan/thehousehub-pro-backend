require("dotenv").config();

const prisma = require("./lib/prisma");

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: {
      isActive: true,
      propertyId: { not: null },
    },
    include: {
      property: true,
      unit: true,
    },
  });

  if (!tenant) {
    console.log("No active tenant with property found.");
    return;
  }

  const fullName = `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim();

  const communication = await prisma.communication.create({
    data: {
      tenantId: tenant.id,
      propertyId: tenant.propertyId,
      type: "NOTE",
      direction: "INBOUND",
      subject: "Test tenant message",
      messageSummary: "Hello admin, this is a test message from tenant.",
      relatedTo: "TENANT_CONTACT_TEST",
      senderName: fullName || tenant.email || "Tenant",
      receiverName: tenant.property?.ownerName || "Property Management",
      metadata: {
        unitId: tenant.unitId,
        unitCode: tenant.unit?.unitCode,
        unitName: tenant.unit?.unitName,
        tenantEmail: tenant.email,
      },
    },
  });

  console.log("Communication created successfully:");
  console.log(communication);
}

main()
  .catch((error) => {
    console.error(error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });