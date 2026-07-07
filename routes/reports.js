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
  const company = report.settings?.companyName || report.organization?.name || "The House Hub";
  const rows = report.tables.payments
    .slice(0, 25)
    .map(
      (payment) => `
        <tr>
          <td>${new Date(payment.date).toLocaleDateString()}</td>
          <td>${payment.tenant || "N/A"}</td>
          <td>${payment.property || "N/A"}</td>
          <td>$${payment.amount.toFixed(2)}</td>
          <td>${payment.status}</td>
        </tr>`
    )
    .join("");

  return `
  <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
    <div style="max-width:760px;margin:auto;background:white;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#0f172a;color:white;padding:24px;">
        <p style="margin:0;color:#93c5fd;font-weight:bold;letter-spacing:.08em;">PORTFOLIO REPORT</p>
        <h1 style="margin:8px 0 0;font-size:28px;">${company}</h1>
        <p style="margin:8px 0 0;color:#cbd5e1;">Generated ${new Date(report.generatedAt).toLocaleString()}</p>
      </div>
      <div style="padding:24px;">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
          <div style="background:#f1f5f9;padding:16px;border-radius:12px;"><strong>Revenue</strong><br/>$${report.summary.totalRevenue.toFixed(2)}</div>
          <div style="background:#f1f5f9;padding:16px;border-radius:12px;"><strong>Occupancy</strong><br/>${report.summary.occupancyRate}%</div>
          <div style="background:#f1f5f9;padding:16px;border-radius:12px;"><strong>Properties</strong><br/>${report.summary.properties}</div>
          <div style="background:#f1f5f9;padding:16px;border-radius:12px;"><strong>Tenants</strong><br/>${report.summary.tenants}</div>
        </div>
        <h2 style="margin-top:28px;">Recent Payments</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="text-align:left;color:#64748b;"><th>Date</th><th>Tenant</th><th>Property</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5">No payments found.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </div>`;
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
