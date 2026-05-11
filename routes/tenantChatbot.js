const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

const router = express.Router();

const chatSessions = new Map();

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
  return `MR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
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

function text(value) {
  return String(value || "").toLowerCase();
}

function detectMaintenanceIntent(message) {
  const t = text(message);

  return [
    "water", "eau", "leak", "fuite", "toilet", "wc", "sink", "plumbing",
    "electric", "power", "light", "courant", "chauffage", "heat", "ac",
    "door", "lock", "broken", "cassé", "not working", "ne marche pas",
    "maintenance", "repair", "réparer", "problem", "problème", "kitchen",
    "bathroom", "ceiling", "roof"
  ].some((word) => t.includes(word));
}

function detectCategory(message) {
  const t = text(message);

  if (["water", "eau", "leak", "fuite", "toilet", "wc", "sink", "kitchen", "bathroom"].some((w) => t.includes(w))) {
    return "PLUMBING";
  }

  if (["electric", "power", "light", "courant"].some((w) => t.includes(w))) {
    return "ELECTRICAL";
  }

  if (["heat", "chauffage", "ac", "hvac"].some((w) => t.includes(w))) {
    return "HVAC";
  }

  if (["door", "lock", "clé", "serrure"].some((w) => t.includes(w))) {
    return "LOCKS";
  }

  return "GENERAL";
}

function detectPriority(message) {
  const t = text(message);

  if (["urgent", "emergency", "flood", "inondation", "fire", "smoke", "everywhere"].some((w) => t.includes(w))) {
    return "URGENT";
  }

  if (["not working", "ne marche pas", "no water", "pas d'eau", "no power"].some((w) => t.includes(w))) {
    return "HIGH";
  }

  return "MEDIUM";
}

function yesIntent(message) {
  const t = text(message).trim();
  return ["yes", "yeah", "ok", "okay", "sure", "create", "confirm", "oui", "vas-y", "go"].some((w) => t.includes(w));
}

function noIntent(message) {
  const t = text(message).trim();
  return ["no", "non", "cancel", "annuler", "not now"].some((w) => t.includes(w));
}

function answerTenantQuestion(message, tenant) {
  const t = text(message);
  const fullName = `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim();

  const lease = tenant.leases?.[0] || null;
  const rent = lease?.rentAmount || tenant.unit?.monthlyRent || 0;

  if (t.includes("rent") || t.includes("loyer")) {
    return `Your monthly rent is $${Number(rent || 0).toFixed(2)}.`;
  }

  if (t.includes("unit") || t.includes("apartment") || t.includes("appartement")) {
    return `Your unit is ${tenant.unit?.unitCode || tenant.unit?.unitName || "not assigned yet"}.`;
  }

  if (t.includes("property") || t.includes("house") || t.includes("home") || t.includes("maison")) {
    return `Your property is ${tenant.property?.name || tenant.property?.code || "not assigned yet"}.`;
  }

  if (t.includes("name") || t.includes("full name") || t.includes("nom")) {
    return `Your full name is ${fullName || "not available"}.`;
  }

  if (t.includes("email") || t.includes("mail")) {
    return `Your email is ${tenant.email || "not available"}.`;
  }

  if (t.includes("phone") || t.includes("telephone") || t.includes("téléphone")) {
    return `Your phone number is ${tenant.phone || "not available"}.`;
  }

  if (t.includes("lease") || t.includes("end date") || t.includes("expiration")) {
    const endDate = lease?.endDate || tenant.leaseEndDate;
    return endDate
      ? `Your lease end date is ${new Date(endDate).toLocaleDateString()}.`
      : "Your lease end date is not available yet.";
  }

  if (t.includes("landlord") || t.includes("admin") || t.includes("manager")) {
    return "For landlord or admin contact, please use the Contact Landlord page or check your tenant contact section.";
  }

  return null;
}

router.post("/message", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "Tenant not linked to user" });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, organizationId },
      include: {
        property: true,
        unit: true,
        leases: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!tenant) {
      return res.status(403).json({ error: "Unauthorized tenant" });
    }

    const sessionKey = `${organizationId}:${tenantId}`;
    const currentSession = chatSessions.get(sessionKey);

    if (currentSession?.type === "MAINTENANCE_CONFIRMATION") {
      if (yesIntent(message)) {
        const requestNumber = await generateUniqueRequestNumber();

        const createdRequest = await prisma.maintenanceRequest.create({
          data: {
            organizationId,
            requestNumber,
            propertyId: tenant.propertyId,
            unitId: tenant.unitId || null,
            tenantId: tenant.id,
            title: currentSession.title,
            description: currentSession.description,
            category: currentSession.category,
            priority: currentSession.priority,
            status: "OPEN",
            entryPermission: currentSession.entryPermission || false,
            locationNote: currentSession.locationNote || null,
          },
          include: {
            property: true,
            unit: true,
            tenant: true,
            contractor: true,
          },
        });

        chatSessions.delete(sessionKey);

        try {
          await createNotification({
            tenantId: tenant.id,
            title: "Maintenance request created",
            message: `Your request ${createdRequest.requestNumber} has been created from the chatbot.`,
            type: "INFO",
            category: "MAINTENANCE",
          });
        } catch (err) {
          console.error("Chatbot notification error:", err);
        }

        return res.status(201).json({
          success: true,
          action: "MAINTENANCE_CREATED",
          reply: `I have created your maintenance request. Your request number is ${createdRequest.requestNumber}. Our team will review it shortly.`,
          maintenanceRequest: createdRequest,
        });
      }

      if (noIntent(message)) {
        chatSessions.delete(sessionKey);
        return res.json({
          success: true,
          action: "CANCELLED",
          reply: "Okay, I cancelled the maintenance request creation. You can describe the issue again whenever you are ready.",
        });
      }

      currentSession.description += `\nAdditional detail: ${message}`;
      chatSessions.set(sessionKey, currentSession);

      return res.json({
        success: true,
        action: "ASK_CONFIRMATION",
        reply: "Thank you for the extra detail. Should I create a maintenance request now so a qualified technician can review it? Reply Yes or No.",
      });
    }

    const directAnswer = answerTenantQuestion(message, tenant);
    if (directAnswer) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: directAnswer,
      });
    }

    if (detectMaintenanceIntent(message)) {
      if (!tenant.propertyId) {
        return res.status(400).json({ error: "Tenant has no property linked" });
      }

      const category = detectCategory(message);
      const priority = detectPriority(message);

      chatSessions.set(sessionKey, {
        type: "MAINTENANCE_CONFIRMATION",
        title: `Tenant Issue - ${category}`,
        description: message,
        category,
        priority,
        entryPermission: false,
        locationNote: tenant.unit?.unitCode
          ? `Reported from tenant chatbot - Unit ${tenant.unit.unitCode}`
          : "Reported from tenant chatbot",
      });

      return res.json({
        success: true,
        action: "ASK_CONFIRMATION",
        reply:
          `I understand there is a ${category.toLowerCase().replace("_", " ")} issue. ` +
          `Before I create the request, can you confirm: is this happening now, and should we create a maintenance request for a qualified technician to come for intervention? Reply Yes or No.`,
      });
    }

    return res.json({
      success: true,
      action: "ANSWER",
      reply: `Hello ${tenant.firstName || ""} 👋 I can help you with your rent, lease, unit, property, payments, documents, landlord contact, or maintenance issues.`,
    });
  } catch (error) {
    console.error("POST /api/tenant-chatbot/message error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to process chatbot message",
    });
  }
});

module.exports = router;