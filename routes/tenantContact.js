const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

/**
 * POST /api/tenant/contact
 */
router.post("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        error: "Subject and message are required",
      });
    }

    const tenantId = req.user.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        error: "Tenant not linked to user",
      });
    }

    // 🔥 Save message as communication
    const communication = await prisma.communication.create({
      data: {
        tenantId,
        type: "NOTE",
        direction: "INBOUND",
        subject,
        messageSummary: message,
        senderName: "Tenant",
        receiverName: "Management",
      },
    });

    return res.json({
      success: true,
      message: "Message sent successfully",
      communication,
    });
  } catch (error) {
    console.error("Tenant contact error:", error);
    return res.status(500).json({
      error: "Failed to send message",
    });
  }
});

module.exports = router;