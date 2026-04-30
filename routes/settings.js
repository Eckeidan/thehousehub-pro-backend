const express = require("express");
const prisma = require("../lib/prisma");
const {
  requireAuth,
  requireRole,
  requireAdminOrOwner,
} = require("../middleware/auth");

const router = express.Router();

/* GET settings — ADMIN, OWNER, TENANT can read */
router.get("/", requireAuth, requireRole("ADMIN", "OWNER", "TENANT"), async (req, res) => {
  try {
    let settings = await prisma.appSetting.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!settings) {
      settings = await prisma.appSetting.create({ data: {} });
    }

    res.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

/* UPDATE settings — only ADMIN / OWNER */
router.put("/", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    let settings = await prisma.appSetting.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!settings) {
      settings = await prisma.appSetting.create({ data: {} });
    }

    const updated = await prisma.appSetting.update({
      where: { id: settings.id },
      data: {
        companyName: req.body.companyName ?? settings.companyName,
        email: req.body.email ?? settings.email,
        currency: req.body.currency ?? settings.currency,
        timezone: req.body.timezone ?? settings.timezone,

        logoUrl: req.body.logoUrl ?? settings.logoUrl,
        primaryColor: req.body.primaryColor ?? settings.primaryColor,
        supportEmail: req.body.supportEmail ?? settings.supportEmail,

        bankName: req.body.bankName ?? settings.bankName,
        bankAccountName: req.body.bankAccountName ?? settings.bankAccountName,
        bankAccountNumber:
          req.body.bankAccountNumber ?? settings.bankAccountNumber,
        paymentInstructions:
          req.body.paymentInstructions ?? settings.paymentInstructions,
        rentDueDay:
          req.body.rentDueDay !== undefined
            ? Number(req.body.rentDueDay)
            : settings.rentDueDay,
        lateFeeAmount:
          req.body.lateFeeAmount !== undefined
            ? Number(req.body.lateFeeAmount)
            : settings.lateFeeAmount,

        tenantAccessDefault:
          req.body.tenantAccessDefault ?? settings.tenantAccessDefault,
        notifications: req.body.notifications ?? settings.notifications,
        maintenanceAlerts:
          req.body.maintenanceAlerts ?? settings.maintenanceAlerts,
        leaseReminders: req.body.leaseReminders ?? settings.leaseReminders,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

module.exports = router;