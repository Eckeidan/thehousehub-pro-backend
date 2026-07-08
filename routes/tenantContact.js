const express = require("express");
const router = express.Router();

const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

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

function tenantFullName(tenant) {
  return `${tenant?.firstName || ""} ${tenant?.lastName || ""}`.trim();
}

async function resolveTenant(req, organizationId) {
  const tenantId = req.user?.tenantId;

  if (!tenantId) return null;

  return prisma.tenant.findFirst({
    where: { id: tenantId, organizationId },
    include: {
      property: true,
      unit: true,
    },
  });
}

async function notifyAdminsAboutTenantMessage(organizationId, tenant, communication) {
  const admins = await prisma.user.findMany({
    where: {
      organizationId,
      isActive: true,
      role: {
        in: ["ADMIN", "OWNER"],
      },
    },
    select: {
      id: true,
    },
  });

  const sender = tenantFullName(tenant) || tenant.email || "Tenant";

  await Promise.allSettled(
    admins.map((admin) =>
      createNotification({
        userId: admin.id,
        title: "New tenant message",
        message: `${sender}: ${communication.messageSummary}`,
        type: "INFO",
        category: "SYSTEM",
      })
    )
  );
}

router.get("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    if (!req.user?.tenantId) {
      return res.status(400).json({ error: "Tenant not linked to user" });
    }

    const tenant = await resolveTenant(req, organizationId);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant profile not found" });
    }

    const setting =
      (await prisma.appSetting.findFirst({ where: { organizationId } })) ||
      (await prisma.setting.findFirst());

    return res.json({
      ok: true,
      tenant,
      property: tenant.property,
      unit: tenant.unit,
      landlord: {
        fullName:
          tenant.property?.ownerName ||
          setting?.companyName ||
          "Property Management",
        email: setting?.email || "support@thehousehub.app",
        phone: "Available in property settings",
        office:
          tenant.property?.addressLine1 ||
          "Property management office",
      },
    });
  } catch (error) {
    console.error("Tenant contact GET error:", error);
    return res.status(500).json({ error: "Failed to load contact information" });
  }
});

router.get("/thread", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    if (!req.user?.tenantId) {
      return res.status(400).json({ error: "Tenant not linked to user" });
    }

    const tenant = await resolveTenant(req, organizationId);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant profile not found" });
    }

    const messages = await prisma.communication.findMany({
      where: {
        tenantId: tenant.id,
        tenant: {
          organizationId,
        },
      },
      orderBy: { sentAt: "asc" },
    });

    return res.json({
      ok: true,
      tenant: {
        id: tenant.id,
        fullName: tenantFullName(tenant) || tenant.email || "Tenant",
        email: tenant.email,
        phone: tenant.phone,
      },
      property: tenant.property,
      unit: tenant.unit,
      messages,
    });
  } catch (error) {
    console.error("Tenant contact thread GET error:", error);
    return res.status(500).json({ error: "Failed to load conversation" });
  }
});

router.post("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const { subject, message } = req.body;
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    if (!req.user?.tenantId) {
      return res.status(400).json({ error: "Tenant not linked to user" });
    }

    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({
        error: "Subject and message are required",
      });
    }

    const tenant = await resolveTenant(req, organizationId);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant profile not found" });
    }

    if (!tenant.propertyId) {
      return res.status(400).json({ error: "Tenant not linked to property" });
    }

    const fullName = tenantFullName(tenant);

    const communication = await prisma.communication.create({
      data: {
        tenantId: tenant.id,
        propertyId: tenant.propertyId,
        type: "NOTE",
        direction: "INBOUND",
        subject: subject.trim(),
        messageSummary: message.trim(),
        relatedTo: "TENANT_CONTACT",
        senderName: fullName || tenant.email || "Tenant",
        receiverName: tenant.property?.ownerName || "Property Management",
        metadata: {
          unitId: tenant.unitId,
          unitCode: tenant.unit?.unitCode,
          unitName: tenant.unit?.unitName,
          tenantEmail: tenant.email,
          organizationId,
        },
      },
    });

    await notifyAdminsAboutTenantMessage(organizationId, tenant, communication);

    return res.status(201).json({
      ok: true,
      message: "Message sent successfully",
      communication,
    });
  } catch (error) {
    console.error("Tenant contact POST error:", error);
    return res.status(500).json({ error: "Failed to send tenant message" });
  }
});

module.exports = router;
