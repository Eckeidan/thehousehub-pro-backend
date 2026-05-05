const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function requireOrg(req, res) {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    res.status(403).json({ error: "Organization is required" });
    return null;
  }

  return organizationId;
}

router.get("/", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const totalProperties = await prisma.property.count({
      where: { organizationId },
    });

    const totalUnits = await prisma.unit.count({
      where: { organizationId },
    });

    const totalTenants = await prisma.tenant.count({
      where: { organizationId },
    });

    const openMaintenanceRequests = await prisma.maintenanceRequest.count({
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
      totalProperties,
      totalUnits,
      totalTenants,
      occupancyRate,
      openMaintenanceRequests,
    });
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
    return res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

module.exports = router;