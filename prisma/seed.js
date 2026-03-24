const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");

async function main() {
  const passwordHash = await bcrypt.hash("12345678", 10);

  // ADMIN
  await prisma.user.upsert({
    where: { email: "admin@propertyos.com" },
    update: {
      fullName: "System Admin",
      passwordHash,
      role: "ADMIN",
      isActive: true,
      tenantId: null,
    },
    create: {
      fullName: "System Admin",
      email: "chrismonga@gmail.com",
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
  });

  // OWNER
  await prisma.user.upsert({
    where: { email: "owner@propertyos.com" },
    update: {
      fullName: "Property Owner",
      passwordHash,
      role: "OWNER",
      isActive: true,
      tenantId: null,
    },
    create: {
      fullName: "Property Owner",
      email: "owner@propertyos.com",
      passwordHash,
      role: "OWNER",
      isActive: true,
    },
  });

  const existingTenant = await prisma.tenant.findFirst({
    where: {
      email: {
        not: null,
      },
    },
  });

  if (existingTenant) {
    const tenantEmail = existingTenant.email.toLowerCase();

    await prisma.user.upsert({
      where: { email: tenantEmail },
      update: {
        fullName: `${existingTenant.firstName} ${existingTenant.lastName}`,
        passwordHash,
        role: "TENANT",
        isActive: true,
        tenantId: existingTenant.id,
      },
      create: {
        fullName: `${existingTenant.firstName} ${existingTenant.lastName}`,
        email: tenantEmail,
        passwordHash,
        role: "TENANT",
        isActive: true,
        tenantId: existingTenant.id,
      },
    });

    console.log(`Tenant linked: ${tenantEmail}`);
  } else {
    console.log("No tenant with email found yet.");
  }

  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });