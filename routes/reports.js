const express = require("express");
const nodemailer = require("nodemailer");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

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

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value) || 0;
}

function startOfMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function buildRange(query) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const from = parseDate(query.from, defaultFrom);
  const to = parseDate(query.to, now);

  if (to) {
    to.setHours(23, 59, 59, 999);
  }

  return { from, to };
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrency(value) {
  return `$${toNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function resolvePublicUrl(value) {
  if (!value) return "";
  if (String(value).startsWith("http")) return value;
  const publicBase =
    process.env.PUBLIC_APP_URL ||
    process.env.FRONTEND_URL ||
    "https://thehousehub.app";
  return `${publicBase}${String(value).startsWith("/") ? "" : "/"}${value}`;
}

function getNextRunAt(frequency, from = new Date()) {
  const next = new Date(from);
  const normalized = String(frequency || "WEEKLY").toUpperCase();

  if (normalized === "DAILY") next.setDate(next.getDate() + 1);
  else if (normalized === "MONTHLY") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 7);

  next.setHours(8, 0, 0, 0);
  return next;
}

async function buildReportForOrganization(organizationId, query = {}) {
  const { from, to } = buildRange(query || {});
  const propertyId = query.propertyId ? String(query.propertyId) : null;
  const tenantId = query.tenantId ? String(query.tenantId) : null;
  const status = query.status ? String(query.status).toUpperCase() : null;
  const paymentMethod = query.paymentMethod
    ? String(query.paymentMethod).toUpperCase()
    : null;

  const paymentWhere = {
    organizationId,
    paymentDate: {
      gte: from,
      lte: to,
    },
  };

  if (status && status !== "ALL") paymentWhere.status = status;
  if (paymentMethod && paymentMethod !== "ALL") paymentWhere.paymentMethod = paymentMethod;
  if (propertyId && propertyId !== "ALL") paymentWhere.lease = { propertyId };
  if (tenantId && tenantId !== "ALL") {
    paymentWhere.lease = {
      ...(paymentWhere.lease || {}),
      tenantId,
    };
  }

  const [organization, settings, properties, tenants, payments, maintenance] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, email: true, companyName: true },
      }),
      prisma.appSetting.findFirst({ where: { organizationId } }),
      prisma.property.findMany({
        where: { organizationId, isActive: true },
        include: {
          tenants: { where: { organizationId, isActive: true } },
          leases: { where: { organizationId } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.tenant.findMany({
        where: { organizationId, isActive: true },
        include: {
          property: true,
          leases: { where: { organizationId } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.payment.findMany({
        where: paymentWhere,
        include: {
          lease: {
            include: {
              tenant: true,
              property: true,
            },
          },
        },
        orderBy: { paymentDate: "desc" },
      }),
      prisma.maintenanceRequest.findMany({
        where: {
          organizationId,
          createdAt: { gte: from, lte: to },
          ...(propertyId && propertyId !== "ALL" ? { propertyId } : {}),
          ...(tenantId && tenantId !== "ALL" ? { tenantId } : {}),
        },
        include: {
          property: true,
          tenant: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const paidPayments = payments.filter((payment) => payment.status === "PAID");
  const pendingPayments = payments.filter((payment) => payment.status === "PENDING");
  const rejectedPayments = payments.filter((payment) => payment.status === "FAILED");
  const totalRevenue = paidPayments.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const pendingRevenue = pendingPayments.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const rejectedRevenue = rejectedPayments.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const totalRentPotential = properties.reduce(
    (sum, property) => sum + toNumber(property.monthlyRent),
    0
  );
  const occupiedProperties = properties.filter((property) => property.tenants.length > 0).length;
  const occupancyRate = properties.length
    ? Math.round((occupiedProperties / properties.length) * 100)
    : 0;

  const months = new Map();
  for (let cursor = new Date(from); cursor <= to; cursor.setMonth(cursor.getMonth() + 1)) {
    const key = startOfMonth(cursor);
    months.set(key, {
      month: key,
      paid: 0,
      pending: 0,
      rejected: 0,
      payments: 0,
    });
  }

  payments.forEach((payment) => {
    const key = startOfMonth(new Date(payment.paymentDate));
    const bucket = months.get(key) || {
      month: key,
      paid: 0,
      pending: 0,
      rejected: 0,
      payments: 0,
    };

    bucket.payments += 1;
    if (payment.status === "PAID") bucket.paid += toNumber(payment.amount);
    if (payment.status === "PENDING") bucket.pending += toNumber(payment.amount);
    if (payment.status === "FAILED") bucket.rejected += toNumber(payment.amount);
    months.set(key, bucket);
  });

  const propertyMap = new Map();
  properties.forEach((property) => {
    propertyMap.set(property.id, {
      id: property.id,
      code: property.code,
      name: property.name || property.code,
      city: property.city || "",
      state: property.state || "",
      status: property.occupancyStatus || "UNKNOWN",
      tenants: property.tenants.length,
      monthlyRent: toNumber(property.monthlyRent),
      paid: 0,
      pending: 0,
      rejected: 0,
      maintenance: 0,
    });
  });

  payments.forEach((payment) => {
    const property = payment.lease?.property;
    if (!property?.id || !propertyMap.has(property.id)) return;
    const row = propertyMap.get(property.id);
    if (payment.status === "PAID") row.paid += toNumber(payment.amount);
    if (payment.status === "PENDING") row.pending += toNumber(payment.amount);
    if (payment.status === "FAILED") row.rejected += toNumber(payment.amount);
  });

  maintenance.forEach((request) => {
    if (!request.propertyId || !propertyMap.has(request.propertyId)) return;
    propertyMap.get(request.propertyId).maintenance += 1;
  });

  const maintenanceByStatus = maintenance.reduce((acc, item) => {
    const key = item.status || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const paymentsByStatus = payments.reduce((acc, item) => {
    const key = item.status || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    organization,
    settings,
    filters: {
      from: from.toISOString(),
      to: to.toISOString(),
      propertyId,
      tenantId,
      status: status || "ALL",
      paymentMethod: paymentMethod || "ALL",
    },
    summary: {
      properties: properties.length,
      tenants: tenants.length,
      occupiedProperties,
      occupancyRate,
      totalRevenue,
      pendingRevenue,
      rejectedRevenue,
      totalRentPotential,
      maintenanceOpen: maintenance.filter((item) =>
        ["OPEN", "IN_PROGRESS", "ON_HOLD"].includes(String(item.status))
      ).length,
      maintenanceTotal: maintenance.length,
    },
    charts: {
      revenueByMonth: Array.from(months.values()),
      paymentsByStatus: Object.entries(paymentsByStatus).map(([name, value]) => ({
        name,
        value,
      })),
      maintenanceByStatus: Object.entries(maintenanceByStatus).map(([name, value]) => ({
        name,
        value,
      })),
      propertyPerformance: Array.from(propertyMap.values()),
    },
    options: {
      properties: properties.map((property) => ({
        id: property.id,
        name: property.name || property.code,
        code: property.code,
      })),
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        name: `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim(),
        email: tenant.email,
      })),
    },
    tables: {
      payments: payments.map((payment) => ({
        id: payment.id,
        date: payment.paymentDate,
        tenant: `${payment.lease?.tenant?.firstName || ""} ${
          payment.lease?.tenant?.lastName || ""
        }`.trim(),
        property: payment.lease?.property?.name || payment.lease?.property?.code || "",
        amount: toNumber(payment.amount),
        method: payment.paymentMethod,
        status: payment.status,
        reference: payment.reference || "",
      })),
      properties: Array.from(propertyMap.values()),
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        name: `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim(),
        email: tenant.email || "",
        phone: tenant.phone || "",
        property: tenant.property?.name || tenant.property?.code || "",
        status: tenant.status,
        leaseStatus: tenant.leaseStatus,
        rent: toNumber(tenant.monthlyRent || tenant.property?.monthlyRent),
      })),
      maintenance: maintenance.map((request) => ({
        id: request.id,
        requestNumber: request.requestNumber,
        title: request.title,
        property: request.property?.name || request.property?.code || "",
        tenant: request.tenant
          ? `${request.tenant.firstName || ""} ${request.tenant.lastName || ""}`.trim()
          : "",
        category: request.category,
        priority: request.priority,
        status: request.status,
        createdAt: request.createdAt,
      })),
    },
  };
}

function renderReportHtml(report) {
  const company = escapeHtml(
    report.settings?.companyName || report.organization?.companyName || report.organization?.name || "The House Hub"
  );
  const organizationEmail = escapeHtml(report.settings?.email || report.organization?.email || "");
  const supportEmail = escapeHtml(report.settings?.supportEmail || organizationEmail);
  const logoUrl = resolvePublicUrl(report.settings?.logoUrl);
  const generatedAt = new Date(report.generatedAt).toLocaleString();
  const from = new Date(report.filters?.from).toLocaleDateString();
  const to = new Date(report.filters?.to).toLocaleDateString();
  const propertyRows = report.tables.properties
    .slice(0, 12)
    .map(
      (property) => `
        <tr>
          <td>${escapeHtml(property.name || property.code || "N/A")}</td>
          <td>${escapeHtml([property.city, property.state].filter(Boolean).join(", ") || "N/A")}</td>
          <td>${escapeHtml(property.tenants)}</td>
          <td>${formatCurrency(property.monthlyRent)}</td>
          <td>${formatCurrency(property.paid)}</td>
        </tr>`
    )
    .join("");
  const rows = report.tables.payments
    .slice(0, 25)
    .map(
      (payment) => `
        <tr>
          <td>${new Date(payment.date).toLocaleDateString()}</td>
          <td>${escapeHtml(payment.tenant || "N/A")}</td>
          <td>${escapeHtml(payment.property || "N/A")}</td>
          <td>${formatCurrency(payment.amount)}</td>
          <td><span class="status">${escapeHtml(payment.status)}</span></td>
        </tr>`
    )
    .join("");

  return `
  <div style="font-family:Arial,sans-serif;background:#eef3f8;padding:24px;color:#0f172a;">
    <div style="max-width:860px;margin:auto;background:white;border-radius:22px;overflow:hidden;border:1px solid #dbe4ef;box-shadow:0 18px 45px rgba(15,23,42,0.10);">
      <div style="background:#0f172a;color:white;padding:28px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;">
              ${
                logoUrl
                  ? `<img src="${escapeHtml(logoUrl)}" alt="${company} logo" style="height:52px;max-width:180px;object-fit:contain;background:white;border-radius:14px;padding:8px;margin-bottom:16px;">`
                  : `<div style="height:52px;width:52px;border-radius:16px;background:#2563eb;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;margin-bottom:16px;">HH</div>`
              }
              <p style="margin:0;color:#93c5fd;font-size:12px;font-weight:bold;letter-spacing:.12em;">LANDLORD PORTFOLIO REPORT</p>
              <h1 style="margin:8px 0 0;font-size:30px;line-height:1.1;">${company}</h1>
              <p style="margin:10px 0 0;color:#cbd5e1;font-size:14px;">Reporting period: ${from} - ${to}</p>
            </td>
            <td style="vertical-align:top;text-align:right;color:#cbd5e1;font-size:13px;">
              <strong style="color:white;">Generated</strong><br>${escapeHtml(generatedAt)}<br><br>
              ${organizationEmail ? `<strong style="color:white;">Email</strong><br>${organizationEmail}<br><br>` : ""}
              ${supportEmail ? `<strong style="color:white;">Support</strong><br>${supportEmail}` : ""}
            </td>
          </tr>
        </table>
      </div>

      <div style="padding:28px;">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
          <div class="metric"><span>Approved Revenue</span><strong>${formatCurrency(report.summary.totalRevenue)}</strong></div>
          <div class="metric"><span>Pending Revenue</span><strong>${formatCurrency(report.summary.pendingRevenue)}</strong></div>
          <div class="metric"><span>Occupancy</span><strong>${report.summary.occupancyRate}%</strong></div>
          <div class="metric"><span>Open Maintenance</span><strong>${report.summary.maintenanceOpen}</strong></div>
        </div>

        <div style="margin-top:28px;padding:20px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">
          <h2 style="margin:0 0 8px;font-size:20px;">Executive Summary</h2>
          <p style="margin:0;color:#475569;line-height:1.6;font-size:14px;">
            The portfolio has ${report.summary.properties} active properties and ${report.summary.tenants} active tenants.
            ${formatCurrency(report.summary.pendingRevenue)} is pending administrative approval.
            ${report.summary.maintenanceOpen} maintenance request(s) require attention.
          </p>
        </div>

        <h2>Property Performance</h2>
        <table>
          <thead><tr><th>Property</th><th>Market</th><th>Tenants</th><th>Monthly Rent</th><th>Collected</th></tr></thead>
          <tbody>${propertyRows || `<tr><td colspan="5">No properties found.</td></tr>`}</tbody>
        </table>

        <h2>Recent Payments</h2>
        <table>
          <thead><tr><th>Date</th><th>Tenant</th><th>Property</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5">No payments found.</td></tr>`}</tbody>
        </table>
      </div>

      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 28px;color:#64748b;font-size:12px;">
        This report was generated by The House Hub. Figures are scoped to the landlord organization and current report filters.
      </div>
    </div>
  </div>
  <style>
    h2 { margin: 28px 0 12px; font-size: 20px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #64748b; text-transform: uppercase; letter-spacing: .05em; font-size: 11px; border-bottom: 1px solid #e2e8f0; padding: 10px 8px; }
    td { border-bottom: 1px solid #edf2f7; padding: 12px 8px; color: #1e293b; }
    .metric { background:#f1f5f9;border:1px solid #e2e8f0;border-radius:16px;padding:16px; }
    .metric span { display:block;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em; }
    .metric strong { display:block;margin-top:8px;font-size:20px;color:#0f172a; }
    .status { display:inline-block;border-radius:999px;background:#e0f2fe;color:#075985;padding:4px 8px;font-size:11px;font-weight:700; }
  </style>`;
}

router.get("/", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const report = await buildReportForOrganization(organizationId, req.query);
    return res.json(report);
  } catch (error) {
    console.error("Report load error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load reports",
    });
  }
});

router.post("/email", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const report = await buildReportForOrganization(organizationId, req.body?.filters || {});
    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients.map(String).filter(Boolean)
      : [];

    const to = await sendReportEmail(report, recipients);

    return res.json({
      message: "Report sent successfully",
      recipients: to.accepted || recipients,
    });
  } catch (error) {
    console.error("Report email error:", error);
    return res.status(500).json({
      error: error.message || "Failed to send report",
    });
  }
});

async function sendReportEmail(report, recipients = []) {
  const settings = report.settings;
  const fallbackEmail = settings?.email || report.organization?.email;
  const to = recipients.length ? recipients : [fallbackEmail].filter(Boolean);

  if (!to.length) {
    throw new Error("No report recipient configured");
  }

  const company = settings?.companyName || report.organization?.name || "The House Hub";
  const transporter = createTransporter();

  return transporter.sendMail({
    from: `"${company}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to,
    subject: `Portfolio report - ${company}`,
    html: renderReportHtml(report),
    attachments: [
      {
        filename: `the-house-hub-report-${new Date().toISOString().slice(0, 10)}.json`,
        content: JSON.stringify(report, null, 2),
        contentType: "application/json",
      },
    ],
  });
}

router.get("/schedules", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const schedules = await prisma.reportSchedule.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(schedules);
  } catch (error) {
    console.error("Report schedules load error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load report schedules",
    });
  }
});

router.post("/schedules", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients.map(String).filter(Boolean)
      : [];

    if (!recipients.length) {
      return res.status(400).json({ error: "At least one recipient is required" });
    }

    const frequency = String(req.body?.frequency || "WEEKLY").toUpperCase();
    const schedule = await prisma.reportSchedule.create({
      data: {
        organizationId,
        name: req.body?.name || "Landlord portfolio report",
        frequency,
        recipients,
        filters: req.body?.filters || {},
        nextRunAt: getNextRunAt(frequency),
        isActive: true,
      },
    });

    return res.status(201).json(schedule);
  } catch (error) {
    console.error("Report schedule create error:", error);
    return res.status(500).json({
      error: error.message || "Failed to create report schedule",
    });
  }
});

router.patch("/schedules/:id", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existing = await prisma.reportSchedule.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Report schedule not found" });
    }

    const frequency = req.body?.frequency
      ? String(req.body.frequency).toUpperCase()
      : existing.frequency;

    const updated = await prisma.reportSchedule.update({
      where: { id: existing.id },
      data: {
        name: req.body?.name ?? existing.name,
        frequency,
        recipients: Array.isArray(req.body?.recipients)
          ? req.body.recipients.map(String).filter(Boolean)
          : existing.recipients,
        filters: req.body?.filters ?? existing.filters,
        isActive:
          req.body?.isActive === undefined ? existing.isActive : Boolean(req.body.isActive),
        nextRunAt: req.body?.frequency ? getNextRunAt(frequency) : existing.nextRunAt,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("Report schedule update error:", error);
    return res.status(500).json({
      error: error.message || "Failed to update report schedule",
    });
  }
});

async function runDueReportSchedules() {
  const dueSchedules = await prisma.reportSchedule.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: new Date() },
    },
    take: 10,
    orderBy: { nextRunAt: "asc" },
  });

  for (const schedule of dueSchedules) {
    try {
      const report = await buildReportForOrganization(
        schedule.organizationId,
        schedule.filters || {}
      );

      await sendReportEmail(report, schedule.recipients || []);

      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: {
          lastSentAt: new Date(),
          nextRunAt: getNextRunAt(schedule.frequency),
        },
      });
    } catch (error) {
      console.error(`Report schedule ${schedule.id} failed:`, error);
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: {
          nextRunAt: getNextRunAt(schedule.frequency),
        },
      });
    }
  }
}

module.exports = { router, runDueReportSchedules };
