const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");
const { requireAuth, requireAdminOrOwner } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");
const {
  persistCommunicationAttachments,
  uploadCommunicationAttachments,
  withCommunicationAttachments,
} = require("../utils/communicationAttachments");

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

function mapCommunication(message) {
  const fullName = tenantFullName(message.tenant);

  return {
    ...withCommunicationAttachments(message),
    tenant: message.tenant
      ? {
          id: message.tenant.id,
          fullName: fullName || message.tenant.email || "Tenant",
          email: message.tenant.email,
          phone: message.tenant.phone,
        }
      : null,
  };
}

async function getAdminDisplayName(userId, fallbackEmail) {
  if (!userId) return fallbackEmail || "Property Management";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, email: true },
  });

  return user?.fullName || user?.email || fallbackEmail || "Property Management";
}

async function getTenantForAdminThread(tenantId, organizationId) {
  return prisma.tenant.findFirst({
    where: {
      id: tenantId,
      organizationId,
    },
    include: {
      property: true,
      unit: true,
      user: {
        select: {
          id: true,
        },
      },
    },
  });
}

// GET /api/communications
router.get("/", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const conversations = await prisma.communication.findMany({
      where: {
        tenant: {
          organizationId,
        },
      },
      orderBy: { sentAt: "desc" },
      include: {
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        property: {
          select: {
            id: true,
            name: true,
            addressLine1: true,
            city: true,
            state: true,
          },
        },
      },
    });

    return res.json({
      communications: conversations.map(mapCommunication),
    });
  } catch (error) {
    console.error("GET /api/communications error:", error);
    return res.status(500).json({ error: "Failed to load messages" });
  }
});

// GET /api/communications/tenants
router.get("/tenants", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenants = await prisma.tenant.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            addressLine1: true,
            city: true,
            state: true,
          },
        },
        unit: {
          select: {
            id: true,
            unitCode: true,
            unitName: true,
          },
        },
        communications: {
          orderBy: { sentAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    return res.json({
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        tenantId: tenant.id,
        fullName: tenantFullName(tenant) || tenant.email || "Tenant",
        email: tenant.email,
        phone: tenant.phone,
        property: tenant.property,
        unit: tenant.unit,
        lastMessage: tenant.communications?.[0]
          ? withCommunicationAttachments(tenant.communications[0])
          : null,
      })),
    });
  } catch (error) {
    console.error("GET /api/communications/tenants error:", error);
    return res.status(500).json({ error: "Failed to load tenants" });
  }
});

// GET /api/communications/thread/:tenantId
router.get(
  "/thread/:tenantId",
  requireAuth,
  requireAdminOrOwner,
  async (req, res) => {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const tenant = await getTenantForAdminThread(req.params.tenantId, organizationId);

      if (!tenant) {
        return res.status(404).json({ error: "Tenant conversation not found" });
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
        tenant: {
          id: tenant.id,
          fullName: tenantFullName(tenant) || tenant.email || "Tenant",
          email: tenant.email,
          phone: tenant.phone,
        },
        property: tenant.property,
        unit: tenant.unit,
        messages: messages.map(withCommunicationAttachments),
      });
    } catch (error) {
      console.error("GET /api/communications/thread error:", error);
      return res.status(500).json({ error: "Failed to load conversation" });
    }
  }
);

// POST /api/communications/thread/:tenantId/reply
router.post(
  "/thread/:tenantId/reply",
  requireAuth,
  requireAdminOrOwner,
  uploadCommunicationAttachments,
  async (req, res) => {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const message = String(req.body?.message || "").trim();
      const attachments = await persistCommunicationAttachments(req.files);

      if (!message && attachments.length === 0) {
        return res.status(400).json({ error: "Message or attachment is required" });
      }

      const tenant = await getTenantForAdminThread(req.params.tenantId, organizationId);

      if (!tenant) {
        return res.status(404).json({ error: "Tenant conversation not found" });
      }

      const senderName = await getAdminDisplayName(
        req.user?.userId || req.user?.id,
        req.user?.email
      );
      const receiverName = tenantFullName(tenant) || tenant.email || "Tenant";

      const communication = await prisma.communication.create({
        data: {
          tenantId: tenant.id,
          propertyId: tenant.propertyId,
          type: "NOTE",
          direction: "OUTBOUND",
          subject: "Tenant conversation",
          messageSummary:
            message ||
            (attachments.length === 1
              ? "Sent an attachment"
              : `Sent ${attachments.length} attachments`),
          relatedTo: "TENANT_CONTACT",
          senderName,
          receiverName,
          metadata: {
            adminUserId: req.user?.userId || req.user?.id || null,
            adminEmail: req.user?.email || null,
            organizationId,
            attachments,
          },
        },
      });

      if (tenant.user?.id) {
        await createNotification({
          userId: tenant.user.id,
          tenantId: tenant.id,
          title: "New message from management",
          message: communication.messageSummary,
          type: "INFO",
          category: "SYSTEM",
        });
      }

      return res.status(201).json({
        ok: true,
        communication: withCommunicationAttachments(communication),
      });
    } catch (error) {
      console.error("POST /api/communications/thread/reply error:", error);
      return res.status(500).json({ error: "Failed to send reply" });
    }
  }
);

module.exports = router;
