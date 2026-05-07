const express = require("express");
const prisma = require("../lib/prisma");
const {
  requireAuth,
  requireRole,
  requireAdminOrOwner,
} = require("../middleware/auth");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

/* GET settings — organization scoped */
router.get(
  "/",
  requireAuth,
  requireRole("ADMIN", "OWNER", "TENANT"),
  async (req, res) => {
    try {
      const organizationId = getOrganizationId(req);

      if (!organizationId) {
        return res.status(403).json({ error: "Organization is required" });
      }

      let settings = await prisma.appSetting.findFirst({
        where: { organizationId },
      });

      if (!settings) {
        settings = await prisma.appSetting.create({
          data: {
            organizationId,
          },
        });
      }

      return res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      return res.status(500).json({ error: "Failed to fetch settings" });
    }
  }
);

/* UPDATE settings — only ADMIN / OWNER, organization scoped */
router.put("/", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    let settings = await prisma.appSetting.findFirst({
      where: { organizationId },
    });

    if (!settings) {
      settings = await prisma.appSetting.create({
        data: {
          organizationId,
        },
      });
    }

    const updated = await prisma.appSetting.update({
      where: { id: settings.id },
      data: {
        organizationId,

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

    return res.json(updated);
  } catch (error) {
    console.error("Error updating settings:", error);
    return res.status(500).json({ error: "Failed to update settings" });
  }
});

module.exports = router;