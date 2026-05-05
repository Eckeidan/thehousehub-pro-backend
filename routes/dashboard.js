const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

router.get("/", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    console.log("DASHBOARD ORG:", organizationId);
    console.log("DASHBOARD USER:", req.user);

    const totalProperties = await prisma.property.count({
      where: { organizationId },
    });

    const totalUnits = await prisma.unit.count({
      where: { organizationId },
    });

    const totalTenants = await prisma.tenant.count({
      where: { organizationId },
    });

    const openMaintenance = await prisma.maintenanceRequest.count({
      where: {
        organizationId,
        status: {
          in: ["OPEN", "IN_PROGRESS"],
        },
      },
    });

    const occupiedUnits = await prisma.unit.count({
      where: {
        organizationId,
        occupancyStatus: "OCCUPIED",
      },
    });

    const occupancyRate =
      totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

    return res.json({
      organizationId,
      totalProperties,
      totalUnits,
      totalTenants,
      occupancyRate,
      openMaintenance,
      openMaintenanceRequests: openMaintenance,
    });
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
    return res.status(500).json({
      error: error.message || "Failed to load dashboard data",
    });
  }
});

module.exports = router;