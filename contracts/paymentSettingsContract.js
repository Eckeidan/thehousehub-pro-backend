const PAYMENT_SETTINGS_CONTRACT_VERSION = "owner-payment-settings.v1";

const CURRENCY_OPTIONS = Object.freeze([
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "CDF", label: "CDF - Congolese Franc" },
]);

const TIMEZONE_OPTIONS = Object.freeze([
  { value: "UTC", label: "UTC" },
  { value: "Africa/Kinshasa", label: "Africa/Kinshasa" },
  { value: "America/New_York", label: "America/New York" },
]);

const ALLOWED_CURRENCIES = new Set(
  CURRENCY_OPTIONS.map((option) => option.value)
);
const ALLOWED_TIMEZONES = new Set(
  TIMEZONE_OPTIONS.map((option) => option.value)
);

const PAYMENT_SETTINGS_CONTRACT = Object.freeze({
  version: PAYMENT_SETTINGS_CONTRACT_VERSION,
  currencyOptions: CURRENCY_OPTIONS,
  timezoneOptions: TIMEZONE_OPTIONS,
  tenantMapping: Object.freeze([
    {
      key: "bankName",
      label: "Bank / Payment Method",
      tenantLocation: "Tenant portal -> Payment Details",
      fallback: "Not configured",
    },
    {
      key: "bankAccountName",
      label: "Account Name",
      tenantLocation: "Tenant portal -> Payment Details",
      fallback: "Not configured",
    },
    {
      key: "bankAccountNumber",
      label: "Account / Routing / Zelle / CashApp",
      tenantLocation: "Tenant portal -> Payment Details",
      fallback: "Not configured",
    },
    {
      key: "rentDueDay",
      label: "Rent Due Day",
      tenantLocation: "Tenant portal -> Due Date",
      fallback: "1st day of every month",
    },
    {
      key: "lateFeeAmount",
      label: "Late Fee",
      tenantLocation: "Tenant portal -> Late Fee",
      fallback: "$0",
    },
    {
      key: "paymentInstructions",
      label: "Payment Instructions",
      tenantLocation: "Tenant portal -> Payment Instructions",
      fallback: "Not configured",
    },
    {
      key: "supportEmail",
      label: "Support Email",
      tenantLocation: "Tenant portal -> Support",
      fallback: "Company email",
    },
  ]),
  invariants: Object.freeze([
    "settings.organizationId must match the authenticated user organizationId",
    "rentDueDay is an integer in the closed interval [1, 31]",
    "lateFeeAmount is a finite amount greater than or equal to 0",
    "currency is one of USD, EUR, CDF",
    "owner payment settings and tenant payment view use the same field keys",
  ]),
});

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
    errors.push(`${field} must be a valid non-negative amount`);
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

  [
    "tenantAccessDefault",
    "notifications",
    "maintenanceAlerts",
    "leaseReminders",
  ].forEach((field) => {
    if (body[field] !== undefined) {
      payload[field] = Boolean(body[field]);
    }
  });

  return { payload, errors };
}

module.exports = {
  ALLOWED_CURRENCIES,
  ALLOWED_TIMEZONES,
  CURRENCY_OPTIONS,
  PAYMENT_SETTINGS_CONTRACT,
  PAYMENT_SETTINGS_CONTRACT_VERSION,
  TIMEZONE_OPTIONS,
  normalizeSettingsPayload,
};
