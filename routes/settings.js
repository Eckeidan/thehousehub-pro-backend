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

const ALLOWED_CURRENCIES = new Set(["USD", "EUR", "CDF"]);
const ALLOWED_TIMEZONES = new Set([
  "UTC",
  "Africa/Kinshasa",
  "America/New_York",
]);

function normalizeOptionalString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value).trim();
}

function isValidEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
}

function isValidHttpUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizeIntegerInRange(value, field, min, max, errors) {
  if (value === undefined) return undefined;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors.push(`${field} must be an integer between ${min} and ${max}`);
    return undefined;
  }

  return parsed;
}

function normalizeMoney(value, field, errors) {
  if (value === undefined) return undefined;

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${field} must be a valid positive amount`);
    return undefined;
  }

  return parsed;
}

function normalizeSettingsPayload(body = {}) {
  const errors = [];
  const payload = {};

  const stringFields = [
    "companyName",
    "email",
    "logoUrl",
    "primaryColor",
    "supportEmail",
    "bankName",
    "bankAccountName",
    "bankAccountNumber",
    "paymentInstructions",
  ];

  stringFields.forEach((field) => {
    const normalized = normalizeOptionalString(body[field]);
    if (normalized !== undefined) payload[field] = normalized;
  });

  if (payload.email !== undefined && !isValidEmail(payload.email)) {
    errors.push("Company email must be a valid email address");
  }

  if (payload.companyName !== undefined && !payload.companyName) {
    errors.push("Company name is required");
  }

  if (payload.email !== undefined && !payload.email) {
    errors.push("Company email is required");
  }

  if (
    payload.supportEmail !== undefined &&
    !isValidEmail(payload.supportEmail)
  ) {
    errors.push("Support email must be a valid email address");
  }

  if (payload.logoUrl !== undefined && !isValidHttpUrl(payload.logoUrl)) {
    errors.push("Logo URL must be a valid http or https URL");
  }

  if (
    payload.primaryColor !== undefined &&
    !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(payload.primaryColor)
  ) {
    errors.push("Primary brand color must be a valid hex color");
  }

  if (body.currency !== undefined) {
    const currency = String(body.currency).trim().toUpperCase();
    if (!ALLOWED_CURRENCIES.has(currency)) {
      errors.push("Currency is not supported");
    } else {
      payload.currency = currency;
    }
  }

  if (body.timezone !== undefined) {
    const timezone = String(body.timezone).trim();
    if (!ALLOWED_TIMEZONES.has(timezone)) {
      errors.push("Timezone is not supported");
    } else {
      payload.timezone = timezone;
    }
  }

  const rentDueDay = normalizeIntegerInRange(
    body.rentDueDay,
    "Rent due day",
    1,
    31,
    errors
  );
  if (rentDueDay !== undefined) payload.rentDueDay = rentDueDay;

  const lateFeeAmount = normalizeMoney(
    body.lateFeeAmount,
    "Late fee amount",
    errors
  );
  if (lateFeeAmount !== undefined) payload.lateFeeAmount = lateFeeAmount;

  ["tenantAccessDefault", "notifications", "maintenanceAlerts", "leaseReminders"].forEach(
    (field) => {
      if (body[field] !== undefined) {
        payload[field] = Boolean(body[field]);
      }
    }
  );

  return { payload, errors };
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
