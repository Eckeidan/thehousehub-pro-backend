const prisma = require("../lib/prisma");

async function main() {
  console.log("🧹 Cleaning database...");

  await prisma.payment.deleteMany();
  await prisma.maintenanceRequest.deleteMany();
  await prisma.lease.deleteMany();
  await prisma.document.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.property.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  console.log("✅ Database cleaned successfully");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });