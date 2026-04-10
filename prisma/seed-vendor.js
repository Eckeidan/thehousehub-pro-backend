const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting vendor seed...");

  const vendors = [
    {
      companyName: "AquaFix Plumbing Services",
      contactPerson: "Daniel Brooks",
      email: "dispatch@aquafixservices.com",
      phone: "+14695551101",
      specialties:
        "pipe leak, plumbing, drainage, water damage, bathroom leak, kitchen leak",
      serviceCategory: "PLUMBING",
      address: "450 North Avenue",
      city: "Dallas",
      baseFee: 45.0,
      hourlyRate: 30.0,
      rating: 4.8,
      isActive: true,
      notes: "Fast emergency plumber for residential properties",
    },
    {
      companyName: "BrightSpark Electrical Co",
      contactPerson: "Michael Reed",
      email: "support@brightsparkelectric.com",
      phone: "+14695551102",
      specialties:
        "wiring, power outage, lighting, breaker panel, outlet repair, ceiling light",
      serviceCategory: "ELECTRICAL",
      address: "219 Sunset Road",
      city: "Dallas",
      baseFee: 35.0,
      hourlyRate: 28.0,
      rating: 4.6,
      isActive: true,
      notes: "Good for lighting and urgent electrical failures",
    },
    {
      companyName: "CoolAir HVAC Experts",
      contactPerson: "Kevin Morris",
      email: "team@coolairexperts.com",
      phone: "+14695551103",
      specialties:
        "air conditioning, heating, ventilation, thermostat, compressor, cooling repair",
      serviceCategory: "HVAC",
      address: "88 Central Park",
      city: "Dallas",
      baseFee: 50.0,
      hourlyRate: 32.0,
      rating: 4.7,
      isActive: true,
      notes: "Handles AC and heating maintenance",
    },
    {
      companyName: "SecureLock Property Solutions",
      contactPerson: "Andrew Cole",
      email: "info@securelockproperty.com",
      phone: "+14695551104",
      specialties:
        "door lock, key replacement, deadbolt, smart lock, entry door, lock jam",
      serviceCategory: "LOCKS",
      address: "12 River Street",
      city: "Dallas",
      baseFee: 40.0,
      hourlyRate: 26.0,
      rating: 4.5,
      isActive: true,
      notes: "Good for lockouts and entry door issues",
    },
    {
      companyName: "PrimePaint & General Repairs",
      contactPerson: "Samuel Carter",
      email: "office@primepaintrepairs.com",
      phone: "+14695551105",
      specialties:
        "painting, wall repair, minor repairs, compound door, cleanup, handyman, general maintenance",
      serviceCategory: "GENERAL",
      address: "305 Market Street",
      city: "Dallas",
      baseFee: 30.0,
      hourlyRate: 22.0,
      rating: 4.4,
      isActive: true,
      notes: "Fallback vendor for general and uncategorized issues",
    },
  ];

  for (const vendor of vendors) {
    const exists = await prisma.contractor.findFirst({
      where: {
        OR: [
          { companyName: vendor.companyName },
          { phone: vendor.phone },
          { email: vendor.email },
        ],
      },
    });

    if (exists) {
      console.log(`⚠️ Already exists, skipped: ${vendor.companyName}`);
      continue;
    }

    const created = await prisma.contractor.create({
      data: vendor,
    });

    console.log(`✅ Vendor created: ${created.companyName}`);
  }

  const total = await prisma.contractor.count();
  console.log(`🎉 Done. Total contractors in DB: ${total}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });