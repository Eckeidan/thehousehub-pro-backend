const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [
      properties,
      units,
      tenants,
      maintenanceRequests,
      documents,
      payments,
    ] = await Promise.all([
      prisma.property.findMany(),
      prisma.unit.findMany(),
      prisma.tenant.findMany(),
      prisma.maintenanceRequest.findMany(),
      prisma.document.findMany(),
      prisma.payment.findMany(),
    ]);

    const totalUnits = units.length;
    const activeTenants = tenants.filter((tenant) => tenant.isActive !== false).length;
    const occupancyRate =
      totalUnits > 0 ? Math.round((activeTenants / totalUnits) * 100) : 0;

    const openMaintenance = maintenanceRequests.filter(
      (item) => item.status !== "CLOSED" && item.status !== "CANCELLED"
    ).length;

    const missingDocuments = Math.max(0, tenants.length - documents.filter((d) => d.tenantId).length);

    const paymentRisk = payments.filter(
      (payment) => payment.status === "FAILED" || payment.status === "PENDING"
    ).length;

    const insights = [];

    if (occupancyRate >= 90) {
      insights.push({
        id: 1,
        title: "High occupancy performance",
        message:
          "Your portfolio occupancy is very strong. Current unit utilization is performing well.",
        priority: "LOW",
        category: "OCCUPANCY",
      });
    }

    if (openMaintenance > 0) {
      insights.push({
        id: 2,
        title: "Open maintenance requests detected",
        message: `There are ${openMaintenance} open maintenance requests that should be reviewed.`,
        priority: openMaintenance >= 3 ? "HIGH" : "MEDIUM",
        category: "MAINTENANCE",
      });
    }

    if (missingDocuments > 0) {
      insights.push({
        id: 3,
        title: "Missing tenant documents",
        message: `${missingDocuments} tenant record(s) may still be missing linked documents.`,
        priority: "MEDIUM",
        category: "DOCUMENTS",
      });
    }

    if (paymentRisk > 0) {
      insights.push({
        id: 4,
        title: "Payment follow-up suggested",
        message: `${paymentRisk} payment record(s) are pending or failed and should be reviewed.`,
        priority: "MEDIUM",
        category: "FINANCIAL",
      });
    }

    if (insights.length === 0) {
      insights.push({
        id: 5,
        title: "Portfolio looks stable",
        message:
          "No major operational warning is currently detected from the available data.",
        priority: "LOW",
        category: "COMPLIANCE",
      });
    }

    const stats = {
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
        ? "Upload missing tenant identity or lease documents."
        : "Document completeness is in good shape.",
      paymentRisk > 0
        ? "Monitor payment activity and follow up on pending or failed rent records."
        : "Rent collection signals currently look stable.",
      "Keep inspections and document records updated for all occupied units.",
      occupancyRate < 100
        ? "Review vacant units and prepare leasing actions."
        : "Maintain current occupancy while monitoring turnover risk.",
    ];

    res.json({
      stats,
      insights,
      recommendations,
    });
  } catch (error) {
    console.error("Error generating insights:", error);
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

module.exports = router;