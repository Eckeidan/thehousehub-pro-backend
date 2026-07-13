const express = require("express");
const prisma = require("../lib/prisma");
const {
  requireAuth,
  requireRole,
  requireAdminOrOwner,
} = require("../middleware/auth");
const {
  PAYMENT_SETTINGS_CONTRACT,
  PAYMENT_SETTINGS_CONTRACT_VERSION,
  normalizeSettingsPayload,
} = require("../contracts/paymentSettingsContract");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

function attachSettingsContractHeader(res) {
  res.set("X-Settings-Contract-Version", PAYMENT_SETTINGS_CONTRACT_VERSION);
}

/* GET payment settings contract — shared owner/tenant field map */
router.get(
  "/payment-contract",
  requireAuth,
  requireRole("ADMIN", "OWNER", "TENANT"),
  async (req, res) => {
    attachSettingsContractHeader(res);
    return res.json(PAYMENT_SETTINGS_CONTRACT);
  }
);

/* GET settings — organization scoped */
router.get(
  "/",
  requireAuth,
  requireRole("ADMIN", "OWNER", "TENANT"),
  async (req, res) => {
    try {
      attachSettingsContractHeader(res);
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
    attachSettingsContractHeader(res);
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

    const { payload, errors } = normalizeSettingsPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Invalid settings payload",
        details: errors,
      });
    }

    const updated = await prisma.appSetting.update({
      where: { id: settings.id },
      data: {
        organizationId,

        companyName: payload.companyName ?? settings.companyName,
        email: payload.email ?? settings.email,
        currency: payload.currency ?? settings.currency,
        timezone: payload.timezone ?? settings.timezone,

        logoUrl: payload.logoUrl ?? settings.logoUrl,
        primaryColor: payload.primaryColor ?? settings.primaryColor,
        supportEmail: payload.supportEmail ?? settings.supportEmail,

        bankName: payload.bankName ?? settings.bankName,
        bankAccountName: payload.bankAccountName ?? settings.bankAccountName,
        bankAccountNumber:
          payload.bankAccountNumber ?? settings.bankAccountNumber,
        paymentInstructions:
          payload.paymentInstructions ?? settings.paymentInstructions,

        rentDueDay: payload.rentDueDay ?? settings.rentDueDay,
        lateFeeAmount: payload.lateFeeAmount ?? settings.lateFeeAmount,

        tenantAccessDefault:
          payload.tenantAccessDefault ?? settings.tenantAccessDefault,
        notifications: payload.notifications ?? settings.notifications,
        maintenanceAlerts:
          payload.maintenanceAlerts ?? settings.maintenanceAlerts,
        leaseReminders: payload.leaseReminders ?? settings.leaseReminders,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("Error updating settings:", error);
    return res.status(500).json({ error: "Failed to update settings" });
  }
});

module.exports = router;
