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
        return res.status(403).json({ error: "Organization is required" });
      }

      const [
        properties,
        tenants,
        maintenanceRequests,
        documents,
        payments,
      ] = await Promise.all([
        prisma.property.findMany({
          where: {
            organizationId,
            isActive: true,
          },
          include: {
            tenants: {
              where: {
                organizationId,
                isActive: true,
              },
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),

        prisma.tenant.findMany({
          where: {
            organizationId,
            isActive: true,
          },
        }),

        prisma.maintenanceRequest.findMany({
          where: {
            organizationId,
          },
        }),

        prisma.document.findMany({
          where: {
            organizationId,
          },
        }),

        prisma.payment.findMany({
          where: {
            organizationId,
          },
        }),
      ]);

      const totalProperties = properties.length;

      const occupiedProperties = properties.filter(
        (property) => property.tenants && property.tenants.length > 0
      ).length;

      const occupancyRate =
        totalProperties > 0
          ? Math.round((occupiedProperties / totalProperties) * 100)
          : 0;

      const openMaintenance = maintenanceRequests.filter(
        (item) =>
          item.status !== "CLOSED" &&
          item.status !== "CANCELLED" &&
          item.status !== "RESOLVED"
      ).length;

      const tenantDocuments = documents.filter((doc) => doc.tenantId).length;

      const missingDocuments = Math.max(
        0,
        tenants.length - tenantDocuments
      );

      const paymentRisk = payments.filter(
        (payment) =>
          payment.status === "FAILED" ||
          payment.status === "PENDING" ||
          payment.status === "OVERDUE"
      ).length;

      const insights = [];

      if (occupancyRate >= 90 && totalProperties > 0) {
        insights.push({
          id: "occupancy-strong",
          title: "High occupancy performance",
          message:
            "Your portfolio occupancy is strong. Most active properties are currently linked to tenants.",
          priority: "LOW",
          category: "OCCUPANCY",
          reviewUrl: "/properties",
          buttonLabel: "Review",
        });
      }

      if (occupancyRate < 90 && totalProperties > 0) {
        insights.push({
          id: "occupancy-review",
          title: "Occupancy can be improved",
          message: `${occupiedProperties} of ${totalProperties} active properties are currently occupied.`,
          priority: occupancyRate < 50 ? "HIGH" : "MEDIUM",
          category: "OCCUPANCY",
          reviewUrl: "/properties",
          buttonLabel: "Review",
        });
      }

      if (openMaintenance > 0) {
        insights.push({
          id: "maintenance-open",
          title: "Open maintenance requests detected",
          message: `There are ${openMaintenance} open maintenance request(s) that should be reviewed.`,
          priority: openMaintenance >= 3 ? "HIGH" : "MEDIUM",
          category: "MAINTENANCE",
          reviewUrl: "/maintenance",
          buttonLabel: "Review",
        });
      }

      if (missingDocuments > 0) {
        insights.push({
          id: "missing-documents",
          title: "Missing tenant documents",
          message: `${missingDocuments} tenant record(s) may still be missing linked documents.`,
          priority: "MEDIUM",
          category: "DOCUMENTS",
          reviewUrl: "/documents",
          buttonLabel: "Review",
        });
      }

      if (paymentRisk > 0) {
        insights.push({
          id: "payment-risk",
          title: "Payment follow-up suggested",
          message: `${paymentRisk} payment record(s) are pending, overdue, or failed and should be reviewed.`,
          priority: "MEDIUM",
          category: "FINANCIAL",
          reviewUrl: "/payments",
          buttonLabel: "Review",
        });
      }

      if (insights.length === 0) {
        insights.push({
          id: "portfolio-stable",
          title: "Portfolio looks stable",
          message:
            "No major operational warning is currently detected from the available organization data.",
          priority: "LOW",
          category: "COMPLIANCE",
          reviewUrl: "/dashboard",
          buttonLabel: "Review",
        });
      }

      const stats = {
        totalProperties,
        occupiedProperties,
        occupancyRate,
        openMaintenance,
        missingDocuments,
        paymentRisk,
        healthySignals: insights.filter((i) => i.priority === "LOW").length,
        highPriority: insights.filter((i) => i.priority === "HIGH").length,
        mediumPriority: insights.filter((i) => i.priority === "MEDIUM").length,
        lowPriority: insights.filter((i) => i.priority === "LOW").length,
      };

      const recommendations = [
        openMaintenance > 0
          ? "Review all open maintenance requests and assign response deadlines."
          : "Maintenance activity is stable. Keep response times consistent.",

        missingDocuments > 0
          ? "Upload missing tenant identity, lease, or support documents."
          : "Document completeness is in good shape.",

        paymentRisk > 0
          ? "Monitor payment activity and follow up on pending, overdue, or failed rent records."
          : "Rent collection signals currently look stable.",

        occupancyRate < 100
          ? "Review available properties and prepare leasing actions."
          : "Maintain current occupancy while monitoring turnover risk.",

        "Keep tenant, property, and maintenance records updated for accurate AI insights.",
      ];

      return res.json({
        stats,
        insights,
        recommendations,
      });
    } catch (error) {
      console.error("Error generating insights:", error);

      return res.status(500).json({
        error: error.message || "Failed to generate insights",
      });
    }
  }
);

module.exports = router;