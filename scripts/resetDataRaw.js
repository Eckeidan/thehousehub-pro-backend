require("dotenv").config();
const prisma = require("../lib/prisma");

async function main() {
  console.log("⏳ Reset complet PostgreSQL en cours...");

  const tables = await prisma.$queryRawUnsafe(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations';
  `);

  if (!tables.length) {
    console.log("ℹ️ Aucune table à vider.");
    return;
  }

  const tableNames = tables.map((t) => `"public"."${t.tablename}"`).join(", ");

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`
  );

  console.log("✅ Toutes les tables ont été vidées avec succès.");
}

main()
  .catch((error) => {
    console.error("❌ Erreur pendant le reset :", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });