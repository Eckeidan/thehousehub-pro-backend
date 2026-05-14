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
  return `MR-${new Date().getFullYear()}-${Math.floor(
    1000 + Math.random() * 9000
  )}`;
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

function yesIntent(message) {
  const t = text(message).trim();
  return [
    "yes",
    "yeah",
    "ok",
    "okay",
    "sure",
    "create",
    "confirm",
    "oui",
    "vas-y",
    "go",
    "allowed",
    "allow",
    "permission",
    "autorise",
    "autorisé",
    "d'accord",
  ].some((w) => t.includes(w));
}

function noIntent(message) {
  const t = text(message).trim();
  return ["no", "non", "cancel", "annuler", "not now", "pas maintenant"].some(
    (w) => t.includes(w)
  );
}

function detectMaintenanceIntent(message) {
  const t = text(message);

  return [
    "water",
    "eau",
    "leak",
    "fuite",
    "toilet",
    "wc",
    "sink",
    "plumbing",
    "electric",
    "power",
    "light",
    "courant",
    "chauffage",
    "heat",
    "ac",
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
    "kitchen",
    "bathroom",
    "ceiling",
    "roof",
    "room",
    "chambre",
  ].some((word) => t.includes(word));
}

function detectCategory(message) {
  const t = text(message);

  if (
    ["water", "eau", "leak", "fuite", "toilet", "wc", "sink", "kitchen", "bathroom"].some(
      (w) => t.includes(w)
    )
  ) {
    return "PLUMBING";
  }

  if (["electric", "power", "light", "courant", "electricity"].some((w) => t.includes(w))) {
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

  if (
    ["urgent", "emergency", "flood", "inondation", "fire", "smoke", "everywhere"].some(
      (w) => t.includes(w)
    )
  ) {
    return "URGENT";
  }

  if (
    ["not working", "ne marche pas", "no water", "pas d'eau", "no power", "no electricity"].some(
      (w) => t.includes(w)
    )
  ) {
    return "HIGH";
  }

  return "MEDIUM";
}

function detectLocation(message, tenant) {
  const t = text(message);

  const locations = [
    "kitchen",
    "bathroom",
    "bedroom",
    "living room",
    "room",
    "toilet",
    "garage",
    "roof",
    "ceiling",
    "door",
    "chambre",
    "salon",
    "cuisine",
    "douche",
    "toilette",
  ];

  const found = locations.find((loc) => t.includes(loc));

  if (found) {
    return tenant.unit?.unitCode
      ? `${found} - Unit ${tenant.unit.unitCode}`
      : found;
  }

  return null;
}

function detectEntryPermission(message) {
  const t = text(message);

  if (
    ["you can enter", "can enter", "allow entry", "permission", "yes enter", "oui vous pouvez", "autorise", "vous pouvez entrer"].some(
      (w) => t.includes(w)
    )
  ) {
    return true;
  }

  if (
    ["do not enter", "don't enter", "no entry", "not allowed", "non n'entrez", "pas entrer", "je n'autorise pas"].some(
      (w) => t.includes(w)
    )
  ) {
    return false;
  }

  return null;
}

function parsePreferredDate(message) {
  const t = text(message);
  const now = new Date();

  if (t.includes("today") || t.includes("aujourd")) {
    return now;
  }

  if (t.includes("tomorrow") || t.includes("demain")) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }

  const dateMatch = String(message).match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

function getMissingFields(session) {
  const missing = [];

  if (!session.description) missing.push("description");
  if (!session.locationNote) missing.push("locationNote");
  if (!session.preferredDate) missing.push("preferredDate");

  if (
    session.entryPermission !== true &&
    session.entryPermission !== false
  ) {
    missing.push("entryPermission");
  }

  return missing;
}

function buildFollowUpQuestion(missing) {
  if (missing.includes("locationNote")) {
    return "Please tell me exactly where the issue is happening. For example: kitchen, bathroom, bedroom, living room, or outside.";
  }

  if (missing.includes("preferredDate")) {
    return "What date is best for maintenance to come? You can answer: today, tomorrow, or a date like 2026-05-15.";
  }

  if (missing.includes("entryPermission")) {
    return "Do you give permission for the landlord or contractor to enter if you are not home? Reply Yes or No.";
  }

  return "Please confirm if I should create the maintenance request now. Reply Yes or No.";
}

function updateSessionFromMessage(session, message, tenant) {
  const location = detectLocation(message, tenant);
  const permission = detectEntryPermission(message);
  const preferredDate = parsePreferredDate(message);

  if (location && !session.locationNote) {
    session.locationNote = location;
  }

  if (permission !== null) {
    session.entryPermission = permission;
  }

  if (preferredDate && !session.preferredDate) {
    session.preferredDate = preferredDate;
  }

  if (message) {
    session.description = session.description
      ? `${session.description}\nAdditional detail: ${message}`
      : message;
  }

  return session;
}

function answerTenantQuestion(message, tenant) {
  const t = text(message);
  const fullName = `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim();

  const lease = tenant.leases?.[0] || null;
  const rent = lease?.rentAmount || tenant.monthlyRent || tenant.unit?.monthlyRent || 0;

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

  return null;
}

async function createMaintenanceFromSession({ session, tenant, organizationId }) {
  const requestNumber = await generateUniqueRequestNumber();

  return prisma.maintenanceRequest.create({
    data: {
      organizationId,
      requestNumber,
      propertyId: tenant.propertyId,
      unitId: tenant.unitId || null,
      tenantId: tenant.id,
      title: session.title,
      description: session.description,
      category: session.category,
      priority: session.priority,
      status: "OPEN",
      preferredDate: session.preferredDate || null,
      entryPermission: session.entryPermission === true,
      locationNote: session.locationNote || "Reported from tenant chatbot",
    },
    include: {
      property: true,
      unit: true,
      tenant: true,
      contractor: true,
    },
  });
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
    let currentSession = chatSessions.get(sessionKey);

    if (currentSession?.type === "MAINTENANCE_FLOW") {
      if (noIntent(message)) {
        chatSessions.delete(sessionKey);
        return res.json({
          success: true,
          action: "CANCELLED",
          reply:
            "Okay, I cancelled the maintenance request creation. You can describe the issue again whenever you are ready.",
        });
      }

      currentSession = updateSessionFromMessage(currentSession, message, tenant);

      const missing = getMissingFields(currentSession);

      if (missing.length > 0) {
        chatSessions.set(sessionKey, currentSession);

        return res.json({
          success: true,
          action: "ASK_FOLLOW_UP",
          missing,
          reply: buildFollowUpQuestion(missing),
        });
      }

      if (!yesIntent(message) && currentSession.awaitingFinalConfirmation !== true) {
        currentSession.awaitingFinalConfirmation = true;
        chatSessions.set(sessionKey, currentSession);

        return res.json({
          success: true,
          action: "ASK_CONFIRMATION",
          reply:
            `I have all the details now:\n` +
            `Issue: ${currentSession.title}\n` +
            `Location: ${currentSession.locationNote}\n` +
            `Preferred date: ${new Date(currentSession.preferredDate).toLocaleDateString()}\n` +
            `Entry permission: ${currentSession.entryPermission ? "Yes" : "No"}\n\n` +
            `Should I create the maintenance request now? Reply Yes or No.`,
        });
      }

      const createdRequest = await createMaintenanceFromSession({
        session: currentSession,
        tenant,
        organizationId,
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
        reply: `Done. I created your maintenance request. Your request number is ${createdRequest.requestNumber}. Our team will review it shortly.`,
        maintenanceRequest: createdRequest,
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
      const locationNote = detectLocation(message, tenant);
      const entryPermission = detectEntryPermission(message);
      const preferredDate = parsePreferredDate(message);

      const newSession = {
        type: "MAINTENANCE_FLOW",
        title: `Tenant Issue - ${category}`,
        description: message,
        category,
        priority,
        locationNote:
          locationNote ||
          (tenant.unit?.unitCode
            ? `Reported from tenant chatbot - Unit ${tenant.unit.unitCode}`
            : null),
        preferredDate,
        entryPermission,
        awaitingFinalConfirmation: false,
      };

      const missing = getMissingFields(newSession);

      if (missing.length > 0) {
        chatSessions.set(sessionKey, newSession);

        return res.json({
          success: true,
          action: "ASK_FOLLOW_UP",
          missing,
          reply:
            `I understand this is a ${category.toLowerCase().replace("_", " ")} issue. ` +
            buildFollowUpQuestion(missing),
        });
      }

      newSession.awaitingFinalConfirmation = true;
      chatSessions.set(sessionKey, newSession);

      return res.json({
        success: true,
        action: "ASK_CONFIRMATION",
        reply:
          `I can create this maintenance request with these details:\n` +
          `Issue: ${newSession.title}\n` +
          `Location: ${newSession.locationNote}\n` +
          `Preferred date: ${new Date(newSession.preferredDate).toLocaleDateString()}\n` +
          `Entry permission: ${newSession.entryPermission ? "Yes" : "No"}\n\n` +
          `Should I create it now? Reply Yes or No.`,
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