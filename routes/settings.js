const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireAdminOrOwner } = require("../middleware/auth");

const router = express.Router();

async function getOrCreateSettings() {
  let settings = await prisma.appSetting.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!settings) {
    settings = await prisma.appSetting.create({
      data: {},
    });
  }

  return settings;
}

/* GET /api/settings */
router.get("/", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json(settings);
  } catch (error) {
    console.error("GET /api/settings error:", error);
    return res.status(500).json({
      error: "Failed to fetch settings",
    });
  }
});

/* PUT /api/settings */
router.put("/", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    const updated = await prisma.appSetting.update({
      where: { id: settings.id },
      data: {
            companyName: req.body.companyName ?? settings.companyName,
            email: req.body.email ?? settings.email,
            currency: req.body.currency ?? settings.currency,
            timezone: req.body.timezone ?? settings.timezone,

            // 🔥 BRANDING
            logoUrl: req.body.logoUrl ?? settings.logoUrl,
            primaryColor: req.body.primaryColor ?? settings.primaryColor,
            supportEmail: req.body.supportEmail ?? settings.supportEmail,

            // 🔥 PAYMENT
            bankName: req.body.bankName ?? settings.bankName,
            bankAccountName:
              req.body.bankAccountName ?? settings.bankAccountName,
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

    return res.json(updated);
  } catch (error) {
    console.error("PUT /api/settings error:", error);
    return res.status(500).json({
      error: error.message || "Failed to update settings",
    });
  }
});

module.exports = router;