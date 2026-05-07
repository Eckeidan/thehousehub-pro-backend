const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

function requireOrg(req, res) {
  const organizationId = getOrganizationId(req);

  if (!organizationId) {
    res.status(403).json({ error: "Organization is required" });
    return null;
  }

  return organizationId;
}

function generateRequestNumber() {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `MR-${year}-${random}`;
}

async function generateUniqueRequestNumber() {
  let requestNumber;
  let exists = true;

  while (exists) {
    requestNumber = generateRequestNumber();

    const found = await prisma.maintenanceRequest.findUnique({
      where: { requestNumber },
    });

    exists = !!found;
  }

  return requestNumber;
}

function detectMaintenanceIntent(message) {
  const text = String(message || "").toLowerCase();

  const keywords = [
    "water",
    "eau",
    "fuite",
    "leak",
    "toilet",
    "wc",
    "sink",
    "plumbing",
    "electric",
    "electricity",
    "power",
    "light",
    "chauffage",
    "heat",
    "ac",
    "hvac",
    "door",
    "lock",
    "broken",
    "cassé",
    "not working",
    "ne marche pas",
    "maintenance",
    "repair",
    "réparer",
    "problem",
    "problème",
  ];

  return keywords.some((word) => text.includes(word));
}

function detectCategory(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("water") || text.includes("eau") || text.includes("leak") || text.includes("fuite") || text.includes("toilet") || text.includes("wc")) {
    return "PLUMBING";
  }

  if (text.includes("electric") || text.includes("power") || text.includes("light") || text.includes("courant")) {
    return "ELECTRICAL";
  }

  if (text.includes("heat") || text.includes("chauffage") || text.includes("ac") || text.includes("hvac")) {
    return "HVAC";
  }

  if (text.includes("door") || text.includes("lock") || text.includes("clé") || text.includes("serrure")) {
    return "LOCKS";
  }

  return "GENERAL";
}

function detectPriority(message) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("urgent") ||
    text.includes("emergency") ||
    text.includes("flood") ||
    text.includes("inondation") ||
    text.includes("fire") ||
    text.includes("smoke")
  ) {
    return "URGENT";
  }

  if (
    text.includes("not working") ||
    text.includes("ne marche pas") ||
    text.includes("no water") ||
    text.includes("pas d'eau") ||
    text.includes("no power")
  ) {
    return "HIGH";
  }

  return "MEDIUM";
}

function makeTitle(message) {
  const text = String(message || "").trim();

  if (!text) return "Maintenance request from tenant";

  if (text.length <= 70) return text;

  return `${text.slice(0, 70)}...`;
}

/**
 * POST /api/tenant-chatbot/message
 */
router.post("/message", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: "Tenant not linked to user" });
    }

    const { message } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const tenant = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        organizationId,
      },
      include: {
        property: true,
        unit: true,
      },
    });

    if (!tenant) {
      return res.status(403).json({ error: "Unauthorized tenant" });
    }

    if (!tenant.propertyId) {
      return res.status(400).json({
        error: "Tenant has no property linked",
      });
    }

    const isMaintenance = detectMaintenanceIntent(message);

    if (isMaintenance) {
      const requestNumber = await generateUniqueRequestNumber();

      const createdRequest = await prisma.maintenanceRequest.create({
        data: {
          organizationId,
          requestNumber,
          propertyId: tenant.propertyId,
          unitId: tenant.unitId || null,
          tenantId: tenant.id,
          title: makeTitle(message),
          description: String(message).trim(),
          category: detectCategory(message),
          priority: detectPriority(message),
          status: "OPEN",
          entryPermission: false,
          locationNote: tenant.unit?.unitCode
            ? `Reported from tenant chatbot - Unit ${tenant.unit.unitCode}`
            : "Reported from tenant chatbot",
        },
        include: {
          property: true,
          unit: true,
          tenant: true,
          contractor: true,
        },
      });

      try {
        await createNotification({
          tenantId: tenant.id,
          title: "Maintenance request created",
          message: `Your request "${createdRequest.title}" has been created from the chatbot.`,
          type: "INFO",
          category: "MAINTENANCE",
        });
      } catch (notificationError) {
        console.error("Chatbot notification error:", notificationError);
      }

      return res.status(201).json({
        success: true,
        action: "MAINTENANCE_CREATED",
        reply:
          "I have created a maintenance request for you. The property manager will review it soon.",
        maintenanceRequest: createdRequest,
      });
    }

    return res.json({
      success: true,
      action: "ANSWER",
      reply: `Hello ${tenant.firstName || ""}, I can help you with your lease, payments, property information, or maintenance requests. If something is broken or not working, describe the problem and I will create a maintenance request for you.`,
      tenant: {
        id: tenant.id,
        fullName: `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim(),
        property: tenant.property?.name || tenant.property?.code || null,
        unit: tenant.unit?.unitCode || tenant.unit?.unitName || null,
        organizationId,
      },
    });
  } catch (error) {
    console.error("POST /api/tenant-chatbot/message error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to process chatbot message",
    });
  }
});

module.exports = router;