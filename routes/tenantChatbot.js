const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

const router = express.Router();

const sessions = new Map();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

function normalize(text) {
  return String(text || "").trim().toLowerCase();
}

function isYes(text) {
  const value = normalize(text);
  return ["yes", "y", "oui", "ok", "okay", "create", "go", "yes create"].some(
    (word) => value.includes(word)
  );
}

function isNo(text) {
  const value = normalize(text);
  return ["no", "non", "cancel", "stop", "not now"].some((word) =>
    value.includes(word)
  );
}

function detectMaintenanceIssue(message) {
  const text = normalize(message);

  const keywords = [
    "water",
    "leak",
    "fuite",
    "plumbing",
    "toilet",
    "sink",
    "bathroom",
    "kitchen",
    "electric",
    "power",
    "door",
    "lock",
    "broken",
    "damage",
    "not working",
    "heating",
    "ac",
    "hvac",
  ];

  return keywords.some((word) => text.includes(word));
}

function detectCategory(message) {
  const text = normalize(message);

  if (
    text.includes("water") ||
    text.includes("leak") ||
    text.includes("fuite") ||
    text.includes("sink") ||
    text.includes("toilet") ||
    text.includes("bathroom") ||
    text.includes("kitchen")
  ) {
    return "PLUMBING";
  }

  if (text.includes("electric") || text.includes("power") || text.includes("light")) {
    return "ELECTRICAL";
  }

  if (text.includes("lock") || text.includes("door") || text.includes("key")) {
    return "LOCKS";
  }

  if (text.includes("heating") || text.includes("ac") || text.includes("hvac")) {
    return "HVAC";
  }

  return "GENERAL";
}

function detectPriority(message) {
  const text = normalize(message);

  if (
    text.includes("urgent") ||
    text.includes("emergency") ||
    text.includes("everywhere") ||
    text.includes("flood") ||
    text.includes("danger") ||
    text.includes("spreading")
  ) {
    return "HIGH";
  }

  return "MEDIUM";
}

async function generateUniqueRequestNumber() {
  const year = new Date().getFullYear();

  while (true) {
    const random = Math.floor(1000 + Math.random() * 9000);
    const requestNumber = `MR-${year}-${random}`;

    const existing = await prisma.maintenanceRequest.findUnique({
      where: { requestNumber },
    });

    if (!existing) return requestNumber;
  }
}

async function getTenantContext(req) {
  const organizationId = getOrganizationId(req);
  const tenantId = req.user?.tenantId;

  if (!organizationId) {
    return { error: "Organization is required" };
  }

  if (!tenantId) {
    return { error: "Tenant account is not linked to a tenant profile" };
  }

  const tenant = await prisma.tenant.findFirst({
    where: {
      id: tenantId,
      organizationId,
    },
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
    return { error: "Unauthorized tenant" };
  }

  const settings = await prisma.appSetting.findFirst({
    where: { organizationId },
  });

  const payments = await prisma.payment.findMany({
    where: {
      organizationId,
      lease: {
        tenantId,
      },
    },
    orderBy: { paymentDate: "desc" },
    take: 10,
    include: {
      lease: true,
    },
  });

  return {
    organizationId,
    tenantId,
    tenant,
    settings,
    payments,
  };
}

function answerTenantQuestion(message, context) {
  const text = normalize(message);
  const { tenant, settings, payments } = context;

  const fullName = `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim();
  const lease = tenant.leases?.[0] || null;
  const monthlyRent = lease?.rentAmount || tenant.unit?.monthlyRent || 0;

  if (text.includes("rent") || text.includes("monthly")) {
    return `Your monthly rent is ${formatMoney(monthlyRent)}.`;
  }

  if (text.includes("unit") || text.includes("apartment")) {
    return `Your unit is ${tenant.unit?.unitCode || "not assigned yet"}${
      tenant.unit?.unitName ? ` — ${tenant.unit.unitName}` : ""
    }.`;
  }

  if (text.includes("property") || text.includes("house") || text.includes("home")) {
    return `Your property is ${
      tenant.property?.name || tenant.property?.code || "not assigned yet"
    }.`;
  }

  if (text.includes("address")) {
    return `Your property address is ${
      tenant.property?.addressLine1 || "not configured yet"
    }${tenant.property?.city ? `, ${tenant.property.city}` : ""}.`;
  }

  if (text.includes("name") || text.includes("full name")) {
    return `Your full name is ${fullName || "not available"}.`;
  }

  if (text.includes("email") || text.includes("mail")) {
    return `Your email is ${tenant.email || "not available"}.`;
  }

  if (
    text.includes("landlord") ||
    text.includes("admin") ||
    text.includes("manager") ||
    text.includes("support")
  ) {
    return `You can contact management at ${
      settings?.supportEmail || settings?.email || "the support email is not configured yet"
    }.`;
  }

  if (text.includes("lease") && (text.includes("end") || text.includes("expire"))) {
    return `Your lease end date is ${
      lease?.endDate || tenant.leaseEndDate
        ? new Date(lease?.endDate || tenant.leaseEndDate).toLocaleDateString()
        : "not configured yet"
    }.`;
  }

  if (text.includes("lease") && (text.includes("start") || text.includes("begin"))) {
    return `Your lease start date is ${
      lease?.startDate || tenant.leaseStartDate
        ? new Date(lease?.startDate || tenant.leaseStartDate).toLocaleDateString()
        : "not configured yet"
    }.`;
  }

  if (text.includes("lease") || text.includes("contract")) {
    return `Your lease status is ${tenant.leaseStatus || lease?.status || "not configured yet"}.`;
  }

  if (text.includes("payment") || text.includes("paid") || text.includes("balance")) {
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return `Your recent recorded payment total is ${formatMoney(totalPaid)}. Your monthly rent is ${formatMoney(monthlyRent)}.`;
  }

  return null;
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

router.post("/message", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const context = await getTenantContext(req);

    if (context.error) {
      return res.status(403).json({ error: context.error });
    }

    const { organizationId, tenantId, tenant } = context;
    const sessionKey = `${organizationId}:${tenantId}`;
    const currentSession = sessions.get(sessionKey);

    if (currentSession?.mode === "MAINTENANCE") {
      if (currentSession.step === "ASK_ACTIVE") {
        currentSession.activeIssue = message;
        currentSession.step = "ASK_LOCATION";
        sessions.set(sessionKey, currentSession);

        return res.json({
          success: true,
          action: "ASK_LOCATION",
          reply:
            "Where exactly is the problem located? For example: kitchen sink, bathroom, ceiling, floor, pipe, or appliance.",
        });
      }

      if (currentSession.step === "ASK_LOCATION") {
        currentSession.location = message;
        currentSession.step = "ASK_URGENCY";
        sessions.set(sessionKey, currentSession);

        return res.json({
          success: true,
          action: "ASK_URGENCY",
          reply:
            "Is this urgent? Is it causing damage, spreading, or stopping you from using part of the house?",
        });
      }

      if (currentSession.step === "ASK_URGENCY") {
        currentSession.urgency = message;
        currentSession.priority = detectPriority(
          `${currentSession.originalMessage} ${message}`
        );
        currentSession.step = "CONFIRM_CREATE";
        sessions.set(sessionKey, currentSession);

        return res.json({
          success: true,
          action: "CONFIRM_CREATE",
          reply: `Thank you. I can create a ${currentSession.priority} priority ${currentSession.category} maintenance request for "${currentSession.originalMessage}" at "${currentSession.location}". Do you want me to create it now?`,
        });
      }

      if (currentSession.step === "CONFIRM_CREATE") {
        if (isNo(message)) {
          sessions.delete(sessionKey);

          return res.json({
            success: true,
            action: "CANCELLED",
            reply:
              "Okay, I did not create the maintenance request. You can message me again when you want to submit it.",
          });
        }

        if (!isYes(message)) {
          return res.json({
            success: true,
            action: "WAITING_CONFIRMATION",
            reply:
              "Please confirm if you want me to create the maintenance request. Reply with Yes to create it, or No to cancel.",
          });
        }

        if (!tenant.propertyId) {
          sessions.delete(sessionKey);

          return res.status(400).json({
            error: "Tenant has no property linked",
          });
        }

        const requestNumber = await generateUniqueRequestNumber();

        const title = `Tenant Issue - ${currentSession.category}`;
        const description = [
          `Initial message: ${currentSession.originalMessage}`,
          `Current status: ${currentSession.activeIssue}`,
          `Location: ${currentSession.location}`,
          `Urgency details: ${currentSession.urgency}`,
        ].join("\n");

        const maintenanceRequest = await prisma.maintenanceRequest.create({
          data: {
            organizationId,
            requestNumber,
            propertyId: tenant.propertyId,
            unitId: tenant.unitId || null,
            tenantId: tenant.id,
            title,
            description,
            category: currentSession.category,
            priority: currentSession.priority,
            status: "OPEN",
            locationNote: currentSession.location,
            entryPermission: false,
          },
          include: {
            property: true,
            unit: true,
            tenant: true,
          },
        });

        try {
          await createNotification({
            tenantId: tenant.id,
            title: "Maintenance request created",
            message: `Your request ${requestNumber} has been submitted successfully.`,
            type: "INFO",
            category: "MAINTENANCE",
          });
        } catch (notificationError) {
          console.error("Chatbot notification error:", notificationError);
        }

        sessions.delete(sessionKey);

        return res.status(201).json({
          success: true,
          action: "MAINTENANCE_CREATED",
          reply: `I have created a maintenance request for you. Your request number is ${requestNumber}. Our team will review it shortly.`,
          maintenanceRequest,
        });
      }
    }

    const directAnswer = answerTenantQuestion(message, context);

    if (directAnswer) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: directAnswer,
      });
    }

    if (detectMaintenanceIssue(message)) {
      const category = detectCategory(message);

      sessions.set(sessionKey, {
        mode: "MAINTENANCE",
        step: "ASK_ACTIVE",
        originalMessage: message,
        category,
        priority: detectPriority(message),
      });

      return res.json({
        success: true,
        action: "ASK_ACTIVE",
        reply:
          "I understand this may be a maintenance issue. Is the problem still happening right now? Please describe what is happening currently.",
      });
    }

    return res.json({
      success: true,
      action: "GENERAL",
      reply: `Hello ${tenant.firstName || ""} 👋 I can help you with your rent, lease, unit, property, payments, documents, landlord contact, or maintenance issues.`,
    });
  } catch (error) {
    console.error("POST /api/tenant-chatbot/message error:", error);
    return res.status(500).json({
      error: error.message || "Tenant assistant failed to respond",
    });
  }
});

module.exports = router;