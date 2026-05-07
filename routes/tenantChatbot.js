const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

function formatDate(value) {
  if (!value) return "not set";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function detectMaintenanceCategory(message) {
  const msg = message.toLowerCase();

  if (msg.includes("water") || msg.includes("sink") || msg.includes("toilet") || msg.includes("bathroom") || msg.includes("plumbing")) {
    return "PLUMBING";
  }

  if (msg.includes("electric") || msg.includes("light") || msg.includes("power") || msg.includes("socket")) {
    return "ELECTRICAL";
  }

  if (msg.includes("heat") || msg.includes("ac") || msg.includes("air") || msg.includes("hvac")) {
    return "HVAC";
  }

  if (msg.includes("lock") || msg.includes("key") || msg.includes("door")) {
    return "LOCKS";
  }

  if (msg.includes("paint") || msg.includes("wall")) {
    return "PAINTING";
  }

  if (msg.includes("pest") || msg.includes("rat") || msg.includes("mouse") || msg.includes("cockroach")) {
    return "PEST_CONTROL";
  }

  if (msg.includes("fridge") || msg.includes("oven") || msg.includes("stove") || msg.includes("washer")) {
    return "APPLIANCE";
  }

  return "GENERAL";
}

function isMaintenanceIssue(message) {
  const msg = message.toLowerCase();

  return (
    msg.includes("not working") ||
    msg.includes("broken") ||
    msg.includes("leak") ||
    msg.includes("leaking") ||
    msg.includes("problem") ||
    msg.includes("issue") ||
    msg.includes("repair") ||
    msg.includes("fix") ||
    msg.includes("damage") ||
    msg.includes("water") ||
    msg.includes("electric") ||
    msg.includes("toilet") ||
    msg.includes("bathroom") ||
    msg.includes("door") ||
    msg.includes("lock")
  );
}

function generateRequestNumber() {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `MR-${year}-${random}`;
}

async function generateUniqueRequestNumber() {
  let requestNumber = generateRequestNumber();
  let exists = true;

  while (exists) {
    const found = await prisma.maintenanceRequest.findUnique({
      where: { requestNumber },
    });

    if (!found) exists = false;
    else requestNumber = generateRequestNumber();
  }

  return requestNumber;
}

router.post("/message", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const tenantId = req.user?.tenantId;
    const message = String(req.body?.message || "").trim();

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    if (!tenantId) {
      return res.status(400).json({ error: "Tenant account is not linked" });
    }

    if (!message) {
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
        leases: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!tenant) {
      return res.status(403).json({ error: "Unauthorized tenant" });
    }

    const settings = await prisma.appSetting.findFirst({
      where: { organizationId },
    });

    const adminUser = await prisma.user.findFirst({
      where: {
        organizationId,
        role: "ADMIN",
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const msg = message.toLowerCase();

    const tenantFullName = `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim();
    const unitCode = tenant.unit?.unitCode || "not assigned";
    const unitName = tenant.unit?.unitName || "";
    const propertyName = tenant.property?.name || tenant.property?.code || "not assigned";
    const propertyAddress = tenant.property?.addressLine1 || "not set";
    const propertyCity = tenant.property?.city || "";

    const currentLease = tenant.leases?.[0] || null;
    const leaseStart = tenant.leaseStartDate || currentLease?.startDate || null;
    const leaseEnd = tenant.leaseEndDate || currentLease?.endDate || null;
    const leaseStatus = tenant.leaseStatus || currentLease?.status || "not set";

    const monthlyRent =
      currentLease?.rentAmount ||
      tenant.unit?.monthlyRent ||
      0;

    if (msg === "hello" || msg === "hi" || msg.includes("good morning") || msg.includes("good evening")) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply:
          `Hello ${tenant.firstName || ""} 👋 I can help you with your rent, lease, unit, property, payments, documents, landlord contact, or maintenance issues.`,
      });
    }

    if (
      msg.includes("my rent") ||
      msg.includes("monthly rent") ||
      msg.includes("rent amount") ||
      msg.includes("how much is my rent") ||
      msg.includes("amount to pay")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your monthly rent is ${formatMoney(monthlyRent)}.`,
      });
    }

    if (
      msg.includes("my unit") ||
      msg.includes("unit number") ||
      msg.includes("what is my unit") ||
      msg.includes("apartment")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your unit is ${unitCode}${unitName ? ` — ${unitName}` : ""}.`,
      });
    }

    if (
      msg.includes("my full name") ||
      msg.includes("my name") ||
      msg.includes("who am i")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your full name is ${tenantFullName}.`,
      });
    }

    if (
      msg.includes("lease end") ||
      msg.includes("end lease") ||
      msg.includes("lease ending") ||
      msg.includes("my end date") ||
      msg.includes("end date")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your lease end date is ${formatDate(leaseEnd)}.`,
      });
    }

    if (
      msg.includes("lease start") ||
      msg.includes("start date") ||
      msg.includes("lease begin")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your lease start date is ${formatDate(leaseStart)}.`,
      });
    }

    if (
      msg.includes("lease status") ||
      msg.includes("my lease") ||
      msg.includes("contract status")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your lease status is ${leaseStatus}. Start date: ${formatDate(leaseStart)}. End date: ${formatDate(leaseEnd)}.`,
      });
    }

    if (
      msg.includes("my property") ||
      msg.includes("property name") ||
      msg.includes("where do i live") ||
      msg.includes("my address")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your property is ${propertyName}. Address: ${propertyAddress}${propertyCity ? `, ${propertyCity}` : ""}.`,
      });
    }

    if (
      msg.includes("landlord email") ||
      msg.includes("landload") ||
      msg.includes("admin mail") ||
      msg.includes("admin email") ||
      msg.includes("manager email") ||
      msg.includes("support email") ||
      msg.includes("management email")
    ) {
      const contactEmail =
        settings?.supportEmail ||
        settings?.email ||
        adminUser?.email ||
        "not configured";

      return res.json({
        success: true,
        action: "ANSWER",
        reply: `The management contact email is ${contactEmail}.`,
      });
    }

    if (
      msg.includes("phone") ||
      msg.includes("contact number") ||
      msg.includes("manager contact")
    ) {
      return res.json({
        success: true,
        action: "ANSWER",
        reply:
          "The management phone number is not configured yet. Please use the Contact Landlord page or email management.",
      });
    }

    if (
      msg.includes("payment") ||
      msg.includes("paid") ||
      msg.includes("balance")
    ) {
      const payments = await prisma.payment.findMany({
        where: {
          organizationId,
          lease: {
            tenantId: tenant.id,
          },
        },
        orderBy: { paymentDate: "desc" },
        take: 5,
      });

      const totalPaid = payments
        .filter((p) => String(p.status).toUpperCase() === "PAID")
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      return res.json({
        success: true,
        action: "ANSWER",
        reply: `Your latest payment records show ${payments.length} recent transaction(s). Total paid from these recent records: ${formatMoney(totalPaid)}.`,
      });
    }

    if (
      msg.includes("document") ||
      msg.includes("documents") ||
      msg.includes("lease file") ||
      msg.includes("files")
    ) {
      const documents = await prisma.document.findMany({
        where: {
          organizationId,
          accessibleToTenant: true,
          OR: [
            { tenantId: tenant.id },
            { propertyId: tenant.propertyId },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      return res.json({
        success: true,
        action: "ANSWER",
        reply: documents.length
          ? `You currently have ${documents.length} accessible document(s). Please open the Documents page to view or download them.`
          : "No tenant documents are available for you right now.",
      });
    }

    if (isMaintenanceIssue(message)) {
      if (!tenant.propertyId) {
        return res.status(400).json({
          success: false,
          error: "Your tenant profile has no property linked.",
        });
      }

      const category = detectMaintenanceCategory(message);
      const requestNumber = await generateUniqueRequestNumber();

      const createdRequest = await prisma.maintenanceRequest.create({
        data: {
          organizationId,
          requestNumber,
          propertyId: tenant.propertyId,
          unitId: tenant.unitId || null,
          tenantId: tenant.id,
          title: `Tenant Issue - ${category}`,
          description: message,
          category,
          priority: category === "PLUMBING" || category === "ELECTRICAL" ? "HIGH" : "MEDIUM",
          status: "OPEN",
          entryPermission: false,
        },
        include: {
          property: true,
          unit: true,
          tenant: true,
        },
      });

      return res.status(201).json({
        success: true,
        action: "MAINTENANCE_CREATED",
        reply:
          `I have created a maintenance request for you. Your request number is ${createdRequest.requestNumber}. Our team will review it shortly.`,
        maintenanceRequest: createdRequest,
      });
    }

    return res.json({
      success: true,
      action: "ANSWER",
      reply:
        "I can help you with your rent, unit, lease dates, property information, documents, payments, landlord contact, or maintenance issues. Please ask your question in a simple way.",
    });
  } catch (error) {
    console.error("Tenant chatbot error:", error);
    return res.status(500).json({
      error: error.message || "Tenant chatbot failed to respond",
    });
  }
});

module.exports = router;