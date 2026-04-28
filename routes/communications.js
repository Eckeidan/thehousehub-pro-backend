const express = require("express");
const router = express.Router();

const prisma = require("../lib/prisma");
const { requireAuth, requireAdminOrOwner } = require("../middleware/auth");

router.get("/", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const communications = await prisma.communication.findMany({
      orderBy: {
        sentAt: "desc",
      },
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

    const formatted = communications.map((item) => ({
      id: item.id,
      type: item.type,
      direction: item.direction,
      subject: item.subject,
      messageSummary: item.messageSummary,
      relatedTo: item.relatedTo,
      sentAt: item.sentAt,
      senderName: item.senderName,
      receiverName: item.receiverName,
      tenant: item.tenant
        ? {
            id: item.tenant.id,
            fullName: `${item.tenant.firstName || ""} ${item.tenant.lastName || ""}`.trim(),
            email: item.tenant.email,
            phone: item.tenant.phone,
          }
        : null,
      property: item.property,
    }));

    return res.json({
      ok: true,
      communications: formatted,
    });
  } catch (error) {
    console.error("Communications list error:", error);
    return res.status(500).json({
      error: "Failed to load communications",
    });
  }
});

module.exports = router;