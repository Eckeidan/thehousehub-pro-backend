require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");

async function main() {
  const fullName = process.env.SUPER_OWNER_NAME || "Platform Super Owner";
  const email = String(process.env.SUPER_OWNER_EMAIL || "")
    .trim()
    .toLowerCase();
  const password = process.env.SUPER_OWNER_PASSWORD || "";

  if (!email || !password) {
    throw new Error(
      "SUPER_OWNER_EMAIL and SUPER_OWNER_PASSWORD environment variables are required."
    );
  }

  if (password.length < 12) {
    throw new Error("SUPER_OWNER_PASSWORD must be at least 12 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      fullName,
      passwordHash,
      role: "SUPER_OWNER",
      isActive: true,
      organizationId: null,
      tenantId: null,
      mustChangePassword: true,
    },
    create: {
      fullName,
      email,
      passwordHash,
      role: "SUPER_OWNER",
      isActive: true,
      organizationId: null,
      tenantId: null,
      mustChangePassword: true,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
    },
  });

  console.log("SUPER_OWNER account ready:");
  console.log(user);
}

main()
  .catch((error) => {
    console.error("Failed to create SUPER_OWNER:", error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
