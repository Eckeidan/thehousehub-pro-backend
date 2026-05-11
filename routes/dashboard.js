const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

router.get(
  "/",
  requireAuth,
  requireRole("ADMIN", "OWNER"),
  async (req, res) => {
    try {
      const organizationId = getOrganizationId(req);

      if (!organizationId) {
        return res.status(403).json({
          error: "Organization is required",
        });
      }

      console.log("✅ DASHBOARD ORG:", organizationId);

      /* 🔒 MULTI-TENANT SAFE COUNTS */

      const totalProperties = await prisma.property.count({
        where: {
          organizationId,
          isActive: true,
        },
      });

      /* Units removed from occupancy logic */
      const totalUnits = 0;

      const totalTenants = await prisma.tenant.count({
        where: {
          organizationId,
          isActive: true,
        },
      });

      const openMaintenance = await prisma.maintenanceRequest.count({
        where: {
          organizationId,
          status: {
            in: ["OPEN", "IN_PROGRESS", "ON_HOLD"],
          },
        },
      });

      /* ✅ NEW OCCUPANCY LOGIC:
         Occupied property = property having at least one active tenant
      */
      const occupiedProperties = await prisma.property.count({
        where: {
          organizationId,
          isActive: true,
          tenants: {
            some: {
              organizationId,
              isActive: true,
            },
          },
        },
      });

      const occupancyRate =
        totalProperties > 0
          ? Math.round((occupiedProperties / totalProperties) * 100)
          : 0;

      return res.json({
        totalProperties,
        totalUnits,
        totalTenants,
        occupancyRate,
        openMaintenance,
        occupiedProperties,
      });
    } catch (error) {
      console.error("❌ Dashboard error:", error);

      return res.status(500).json({
        error: error.message || "Failed to load dashboard data",
      });
    }
  }
);

module.exports = router;