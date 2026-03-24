const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const totalProperties = await prisma.property.count();
    const totalUnits = await prisma.unit.count();
    const totalTenants = await prisma.tenant.count();
    const openMaintenanceRequests = await prisma.maintenanceRequest.count({
      where: {
        status: "open",
      },
    });

    const occupiedUnits = await prisma.unit.count({
      where: {
        status: "occupied",
      },
    });

    const occupancyRate =
      totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

    res.json({
      totalProperties,
      totalUnits,
      totalTenants,
      occupancyRate,
      openMaintenanceRequests,
    });
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

module.exports = router;