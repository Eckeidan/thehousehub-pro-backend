const express = require("express");
const prisma = require("../lib/prisma");
const { createNotification } = require("../utils/createNotification");
const { requireAuth, requireRole } = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

const router = express.Router();

/* -------------------- UPLOAD SETUP -------------------- */

const proofsDir = path.join(__dirname, "..", "uploads", "payment-proofs");

if (!fs.existsSync(proofsDir)) {
  fs.mkdirSync(proofsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, proofsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeBase = path
      .basename(file.originalname || "proof", ext)
      .replace(/[^a-zA-Z0-9-_]/g, "_");

    cb(null, `${Date.now()}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];

    if (allowedMimeTypes.includes(file.mimetype) && allowedExt.includes(ext)) {
      return cb(null, true);
    }

    return cb(new Error("Only JPG, JPEG, PNG, WEBP, and PDF files are allowed."));
  },
});

/* -------------------- HELPERS -------------------- */

function getMonthRange(dateInput) {
  const date = new Date(dateInput);
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

function resolveLeaseMonthlyRent(lease) {
  const possibleFields = [
    lease?.monthlyRent,
    lease?.rentAmount,
    lease?.monthly_rent,
    lease?.rent,
  ];

  const found = possibleFields.find(
    (value) => value !== undefined && value !== null && !isNaN(Number(value))
  );

  return found !== undefined ? Number(found) : null;
}

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

async function getMonthlyPaidTotal(leaseId, paymentDate, excludePaymentId = null) {
  const { start, end } = getMonthRange(paymentDate);

  const where = {
    leaseId,
    paymentDate: {
      gte: start,
      lt: end,
    },
  };

  if (excludePaymentId) {
    where.id = { not: excludePaymentId };
  }

  const payments = await prisma.payment.findMany({
    where,
    select: {
      amount: true,
      status: true,
    },
  });

  return payments.reduce((sum, payment) => {
    const status = String(payment.status || "").toUpperCase();

    if (["CANCELLED", "FAILED", "VOID", "REFUNDED"].includes(status)) {
      return sum;
    }

    return sum + Number(payment.amount || 0);
  }, 0);
}

async function findActiveLeaseForTenant(tenantId, organizationId) {
  const leases = await prisma.lease.findMany({
    where: { tenantId, organizationId },
    include: {
      tenant: true,
      unit: true,
      property: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!leases.length) return null;

  const preferredStatuses = ["ACTIVE", "CURRENT", "ONGOING"];

  return (
    leases.find((lease) =>
      preferredStatuses.includes(String(lease.status || "").toUpperCase())
    ) || leases[0]
  );
}

function resolveTenantMonthlyRent(tenant) {
  const possibleFields = [
    tenant?.monthlyRent,
    tenant?.property?.monthlyRent,
    tenant?.unit?.monthlyRent,
  ];

  const found = possibleFields.find(
    (value) => value !== undefined && value !== null && !isNaN(Number(value))
  );

  return found !== undefined ? Number(found) : null;
}

async function findOrCreateActiveLeaseForTenant(tenantId, organizationId) {
  const existingLease = await findActiveLeaseForTenant(tenantId, organizationId);

  if (existingLease) return existingLease;

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, organizationId },
    include: {
      property: true,
      unit: true,
    },
  });

  if (!tenant) return null;

  const propertyId = tenant.propertyId || tenant.property?.id || tenant.unit?.propertyId;
  const rentAmount = resolveTenantMonthlyRent(tenant);

  if (!propertyId || !rentAmount || rentAmount <= 0) {
    return null;
  }

  const startDate = tenant.leaseStartDate || tenant.createdAt || new Date();

  return prisma.lease.create({
    data: {
      tenantId: tenant.id,
      unitId: tenant.unitId || null,
      propertyId,
      organizationId,
      rentAmount,
      depositAmount: tenant.depositAmount ? Number(tenant.depositAmount) : 0,
      startDate,
      endDate: tenant.leaseEndDate || null,
      billingDay: 1,
      status: tenant.leaseStatus || "ACTIVE",
      notes: "Auto-created from tenant assignment for payment processing.",
    },
    include: {
      tenant: true,
      unit: true,
      property: true,
    },
  });
}

async function removePaymentProofFile(payment) {
  try {
    if (!payment?.proofImageUrl) return;

    const fileName = path.basename(payment.proofImageUrl);
    const fullPath = path.join(proofsDir, fileName);

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    console.error("Failed to remove payment proof file:", error);
  }
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function getTenantEmail(tenant) {
  let email = tenant?.email;

  if (!email && tenant?.id) {
    const linkedUser = await prisma.user.findFirst({
      where: { tenantId: tenant.id },
      select: { email: true },
    });

    email = linkedUser?.email;
  }

  return email || null;
}

async function getAdminRecipients(organizationId) {
  const [settings, admins] = await Promise.all([
    getAppSettings(organizationId),
    prisma.user.findMany({
      where: {
        organizationId,
        role: { in: ["ADMIN", "OWNER"] },
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
      },
    }),
  ]);

  const emails = new Set();

  if (settings?.email) emails.add(settings.email);
  admins.forEach((admin) => {
    if (admin.email) emails.add(admin.email);
  });

  return {
    settings,
    admins,
    emails: Array.from(emails),
  };
}

async function createAdminPaymentNotifications({ organizationId, tenant, payment }) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        organizationId,
        role: { in: ["ADMIN", "OWNER"] },
        isActive: true,
      },
      select: { id: true },
    });

    if (!admins.length) return;

    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        tenantId: tenant?.id || null,
        title: "Payment approval required",
        message: `${tenant?.firstName || "Tenant"} ${tenant?.lastName || ""} submitted a payment of $${Number(payment.amount || 0).toFixed(2)} for approval.`,
        type: "WARNING",
        category: "PAYMENT",
        isRead: false,
      })),
    });
  } catch (error) {
    console.error("Admin payment notification error:", error);
  }
}

async function getAppSettings(organizationId = null) {
  return prisma.appSetting.findFirst({
    where: organizationId ? { organizationId } : undefined,
    orderBy: { createdAt: "asc" },
  });
}

/* -------------------- EMAIL: PAYMENT APPROVED TO TENANT -------------------- */

async function sendPaymentApprovedEmail({ tenant, payment, organizationId = null }) {
  try {
    console.log("sendPaymentApprovedEmail called");

    const to = await getTenantEmail(tenant);

    if (!to) {
      console.log("No tenant email found. Tenant approval email skipped.");
      return;
    }

    const settings = await getAppSettings(organizationId);
    const companyName = settings?.companyName || "The House Hub";
    
    const adminEmail = settings?.email;

    const transporter = createTransporter();

    console.log("Sending tenant approval email to:", to);

    await transporter.sendMail({
      from: `"${companyName}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to,
      replyTo: adminEmail,
      subject: `Payment approved - ${companyName}`,
      html: `
<div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:20px;">
  <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(90deg,#102a67,#173d8e);padding:20px;color:#ffffff;">
      <h2 style="margin:0;">${companyName}</h2>
      <p style="margin:0;font-size:13px;opacity:0.8;">Premium Property Management</p>
    </div>

    <div style="padding:25px;">
      <h2 style="color:#0f172a;margin-bottom:10px;">✅ Payment Approved</h2>

      <p style="font-size:15px;color:#374151;">
        Hello <strong>${tenant?.firstName || "Tenant"}</strong>,
      </p>

      <p style="font-size:15px;color:#374151;">
        Great news! Your payment has been successfully approved.
      </p>

      <div style="background:#f9fafb;border-radius:10px;padding:20px;margin-top:20px;">
        <p style="margin:5px 0;"><strong>Amount:</strong> $${Number(payment.amount || 0).toFixed(2)}</p>
        <p style="margin:5px 0;"><strong>Method:</strong> ${payment.paymentMethod || "N/A"}</p>
        <p style="margin:5px 0;"><strong>Reference:</strong> ${payment.reference || "N/A"}</p>
        <p style="margin:5px 0;"><strong>Status:</strong> <span style="color:#16a34a;font-weight:bold;">APPROVED</span></p>
      </div>

      <div style="margin-top:25px;text-align:center;">
        <a href="https://thehousehub.app/tenant"
           style="display:inline-block;background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">
           View Dashboard
        </a>
      </div>

      <p style="margin-top:25px;font-size:14px;color:#6b7280;">
        Your payment has been recorded and updated in your account.
      </p>
    </div>

    <div style="background:#f1f5f9;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
      <p style="margin:0;">Need help? Contact us at ${adminEmail || "support"}</p>
      <p style="margin:0;">© ${new Date().getFullYear()} ${companyName}</p>
    </div>
  </div>
</div>
`,
    });

    console.log("Tenant approval email sent successfully.");
  } catch (error) {
    console.error("Payment approved email error full:", error);
  }
}

/* -------------------- EMAIL: NEW PAYMENT TO ADMIN -------------------- */

async function sendNewPaymentToAdminEmail({ tenant, payment, organizationId = null }) {
  try {
    console.log("sendNewPaymentToAdminEmail called");

    const { settings, emails } = await getAdminRecipients(organizationId);

    console.log("ADMIN EMAILS FINAL:", emails);

    const companyName = settings?.companyName || "The House Hub";

    if (!emails.length) {
      console.log("No admin email recipients found for payment approval.");
      return;
    }

    const tenantEmail = (await getTenantEmail(tenant)) || "N/A";
    const transporter = createTransporter();

    console.log("Sending admin email to:", emails.join(", "));

    await transporter.sendMail({

      
      from: `"${companyName}" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to: emails,
      replyTo: tenantEmail !== "N/A" ? tenantEmail : undefined,
      subject: `New tenant payment submitted - ${companyName}`,
      html: `
<div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:20px;">
  <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 12px 35px rgba(15,23,42,0.10);">
    <div style="background:linear-gradient(90deg,#7f1d1d,#dc2626);padding:22px;color:#ffffff;">
      <h2 style="margin:0;font-size:22px;">🚨 New Payment Requires Approval</h2>
      <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">Priority alert from ${companyName}</p>
    </div>

    <div style="padding:26px;">
      <p style="font-size:15px;color:#374151;margin:0 0 16px;">
        A tenant has submitted a new payment. Please review and approve/reject it from the admin dashboard.
      </p>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:18px;margin:20px 0;">
        <p style="margin:0 0 8px;color:#991b1b;font-weight:bold;">PRIORITY ACTION REQUIRED</p>
        <p style="margin:0;color:#7f1d1d;font-size:14px;">This payment is currently pending confirmation.</p>
      </div>

      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
        <p><strong>Tenant:</strong> ${tenant?.firstName || ""} ${tenant?.lastName || ""}</p>
        <p><strong>Tenant Email:</strong> ${tenantEmail}</p>
        <p><strong>Amount:</strong> $${Number(payment.amount || 0).toFixed(2)}</p>
        <p><strong>Method:</strong> ${payment.paymentMethod || "N/A"}</p>
        <p><strong>Reference:</strong> ${payment.reference || "N/A"}</p>
        <p><strong>Status:</strong> <span style="color:#dc2626;font-weight:bold;">PENDING APPROVAL</span></p>
      </div>

      <div style="text-align:center;margin-top:26px;">
        <a href="https://thehousehub.app/todo"
          style="display:inline-block;background:#dc2626;color:#ffffff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:bold;">
          Review Payment Now
        </a>
      </div>
    </div>

    <div style="background:#f1f5f9;padding:15px;text-align:center;font-size:12px;color:#64748b;">
      <p style="margin:0;">${companyName} • Smart Property Management</p>
      <p style="margin:4px 0 0;">© ${new Date().getFullYear()} ${companyName}</p>
    </div>
  </div>
</div>
`,
    });

    console.log("Admin payment email sent successfully.");
  } catch (error) {
    console.error("New payment admin email error full:", error);
  }
}

/* -------------------- TENANT PAYMENTS HISTORY -------------------- */

router.get("/tenant-history", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user || !user.tenant) {
      return res.status(404).json({ error: "Tenant profile not found" });
    }

    const payments = await prisma.payment.findMany({
      where: {
        organizationId,
        lease: {
          tenantId: user.tenant.id,
        },
      },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
      orderBy: { paymentDate: "desc" },
    });

    return res.json(payments);
  } catch (error) {
    console.error("Error fetching tenant payments:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch tenant payments",
    });
  }
});

/* -------------------- GET ALL -------------------- */

router.get("/", requireAuth, async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const role = String(req.user?.role || "").toUpperCase();
    const tenantId = req.user?.tenantId || null;

    const where =
      role === "TENANT"
        ? { organizationId, lease: { tenantId } }
        : { organizationId };

    if (role === "TENANT" && !tenantId) {
      return res.status(403).json({ error: "Tenant profile is required" });
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
      orderBy: { paymentDate: "desc" },
    });

    res.json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch payments",
    });
  }
});

/* -------------------- TENANT ACTIVE LEASE SUMMARY -------------------- */

router.get("/tenant-summary", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          include: {
            property: true,
            unit: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const tenantId = user.tenant?.id || user.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        error: "No tenant profile linked to this account",
      });
    }

    const lease = await findOrCreateActiveLeaseForTenant(tenantId, organizationId);

    if (!lease) {
      return res.json({
        lease: null,
        monthlyRent: 0,
      });
    }

    const monthlyRent = resolveLeaseMonthlyRent(lease) || 0;

    return res.json({
      lease,
      monthlyRent,
    });
  } catch (error) {
    console.error("Error fetching tenant payment summary:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch tenant payment summary",
    });
  }
});

/* -------------------- ADMIN PAYMENT APPROVAL TODOs -------------------- */

router.get("/todos", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const payments = await prisma.payment.findMany({
      where: {
        organizationId,
        status: "PENDING",
      },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      count: payments.length,
      payments,
    });
  } catch (error) {
    console.error("Error fetching payment todos:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch payment approvals",
    });
  }
});

/* -------------------- GET ONE -------------------- */

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const role = String(req.user?.role || "").toUpperCase();
    const tenantId = req.user?.tenantId || null;
    const where =
      role === "TENANT"
        ? { id: req.params.id, organizationId, lease: { tenantId } }
        : { id: req.params.id, organizationId };

    if (role === "TENANT" && !tenantId) {
      return res.status(403).json({ error: "Tenant profile is required" });
    }

    const payment = await prisma.payment.findFirst({
      where,
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json(payment);
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch payment",
    });
  }
});

/* -------------------- CREATE BY ADMIN -------------------- */

router.post("/", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const {
      leaseId,
      amount,
      paymentDate,
      paymentMethod,
      status,
      reference,
      notes,
    } = req.body;

    if (!leaseId || !amount || !paymentDate) {
      return res.status(400).json({
        error: "leaseId, amount, and paymentDate are required",
      });
    }

    const parsedAmount = Number(amount);
    const parsedDate = new Date(paymentDate);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Amount must be valid and > 0" });
    }

    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: "Invalid payment date" });
    }

    const lease = await prisma.lease.findFirst({
      where: { id: leaseId, organizationId },
      include: {
        tenant: true,
        unit: true,
        property: true,
      },
    });

    if (!lease) {
      return res.status(404).json({ error: "Lease not found" });
    }

    const monthlyRent = resolveLeaseMonthlyRent(lease);

    if (!monthlyRent || monthlyRent <= 0) {
      return res.status(400).json({ error: "Lease has no valid rent" });
    }

    const totalPaid = await getMonthlyPaidTotal(leaseId, parsedDate);
    const remaining = monthlyRent - totalPaid;

    if (remaining <= 0) {
      return res.status(400).json({ error: "Rent already fully paid" });
    }

    if (parsedAmount > remaining) {
      return res.status(400).json({
        error: `Exceeds remaining balance (${remaining})`,
      });
    }

    const payment = await prisma.payment.create({
      data: {
        leaseId,
        organizationId,
        amount: parsedAmount,
        paymentDate: parsedDate,
        paymentMethod: paymentMethod || "CASH",
        status: status || "PAID",
        reference: reference || null,
        notes: notes || null,
      },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
    });

    if (payment?.lease?.tenant?.id) {
      await createNotification({
        tenantId: payment.lease.tenant.id,
        title: "Payment received",
        message: `Payment of $${payment.amount} received`,
        type: "SUCCESS",
        category: "PAYMENT",
      });
    }

    res.status(201).json(payment);
  } catch (error) {
    console.error("Error creating payment:", error);
    res.status(500).json({
      error: error.message || "Failed to create payment",
    });
  }
});

/* -------------------- TENANT INITIATE PAYMENT -------------------- */

router.post(
  "/tenant-initiate",
  requireAuth,
  requireRole("TENANT"),
  upload.single("proof"),
  async (req, res) => {
    try {
      const userId = req.user?.id || req.user?.userId || req.user?.sub;
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;
      const { amount, paymentMethod, reference, notes, paymentDate } = req.body;

      const parsedAmount = Number(amount);
      const parsedDate = paymentDate ? new Date(paymentDate) : new Date();

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          error: "Amount must be valid and greater than 0",
        });
      }

      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: "Invalid payment date" });
      }

      const user = await prisma.user.findFirst({
        where: { id: userId, organizationId },
        include: {
          tenant: {
            include: {
              property: true,
              unit: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantId = user.tenant?.id || user.tenantId;

      if (!tenantId) {
        return res.status(400).json({
          error: "No tenant profile linked to this account",
        });
      }

      const lease = await findOrCreateActiveLeaseForTenant(tenantId, organizationId);

      if (!lease) {
        return res.status(404).json({
          error:
            "No active lease found for this tenant. Please assign a property and monthly rent before payment.",
        });
      }

      const monthlyRent = resolveLeaseMonthlyRent(lease);

      if (!monthlyRent || monthlyRent <= 0) {
        return res.status(400).json({
          error: "Lease has no valid rent configured",
        });
      }

      const totalPaid = await getMonthlyPaidTotal(lease.id, parsedDate);
      const remaining = monthlyRent - totalPaid;

      if (remaining <= 0) {
        return res.status(400).json({
          error: "This month is already fully paid",
        });
      }

      if (parsedAmount > remaining) {
        return res.status(400).json({
          error: `Payment exceeds this month's remaining balance (${remaining})`,
        });
      }

      const normalizedMethod = String(paymentMethod || "BANK_TRANSFER").toUpperCase();

      const allowedMethods = [
        "CASH",
        "BANK_TRANSFER",
        "CARD",
        "MOBILE_MONEY",
        "CHECK",
        "OTHER",
      ];

      if (!allowedMethods.includes(normalizedMethod)) {
        return res.status(400).json({ error: "Invalid payment method" });
      }

      const proofImageUrl = req.file
        ? `/uploads/payment-proofs/${req.file.filename}`
        : null;

      const createdPayment = await prisma.payment.create({
        data: {
          leaseId: lease.id,
          organizationId,
          amount: parsedAmount,
          paymentDate: parsedDate,
          paymentMethod: normalizedMethod,
          status: "PENDING",
          reference: reference || null,
          notes: notes || null,
          proofImageUrl,
          proofFileName: req.file?.originalname || null,
          proofMimeType: req.file?.mimetype || null,
        },
        include: {
          lease: {
            include: {
              tenant: true,
              unit: true,
              property: true,
            },
          },
        },
      });

      if (createdPayment?.lease?.tenant?.id) {
        await createNotification({
          tenantId: createdPayment.lease.tenant.id,
          title: "Payment initiated",
          message: `Your payment request of $${parsedAmount} has been submitted and is awaiting confirmation.`,
          type: "INFO",
          category: "PAYMENT",
        });

        await createAdminPaymentNotifications({
          organizationId,
          tenant: createdPayment.lease.tenant,
          payment: createdPayment,
        });

        await sendNewPaymentToAdminEmail({
          tenant: createdPayment.lease.tenant,
          payment: createdPayment,
          organizationId,
        });
      }

      return res.status(201).json({
        message: "Payment initiated successfully",
        payment: createdPayment,
        summary: {
          monthlyRent,
          alreadyCommitted: totalPaid,
          remainingBefore: remaining,
          remainingAfter: remaining - parsedAmount,
        },
      });
    } catch (error) {
      console.error("Error initiating tenant payment:", error);

      if (req.file) {
        try {
          const uploadedPath = path.join(proofsDir, req.file.filename);
          if (fs.existsSync(uploadedPath)) {
            fs.unlinkSync(uploadedPath);
          }
        } catch (cleanupError) {
          console.error("Failed to clean uploaded proof:", cleanupError);
        }
      }

      return res.status(500).json({
        error: error.message || "Failed to initiate tenant payment",
      });
    }
  }
);

/* -------------------- UPDATE -------------------- */

router.put("/:id", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existingPayment = await prisma.payment.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
    });

    if (!existingPayment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const nextStatus = req.body?.status
      ? String(req.body.status).toUpperCase()
      : existingPayment.status;
    const nextLeaseId = req.body?.leaseId || existingPayment.leaseId;

    if (nextLeaseId !== existingPayment.leaseId) {
      const lease = await prisma.lease.findFirst({
        where: { id: nextLeaseId, organizationId },
        select: { id: true },
      });

      if (!lease) {
        return res.status(404).json({ error: "Lease not found" });
      }
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: req.params.id },
      data: {
        leaseId: nextLeaseId,
        amount:
          req.body?.amount !== undefined
            ? Number(req.body.amount)
            : existingPayment.amount,
        paymentDate: req.body?.paymentDate
          ? new Date(req.body.paymentDate)
          : existingPayment.paymentDate,
        paymentMethod: req.body?.paymentMethod || existingPayment.paymentMethod,
        status: nextStatus,
        reference:
          req.body?.reference !== undefined
            ? req.body.reference
            : existingPayment.reference,
        notes:
          req.body?.notes !== undefined
            ? req.body.notes
            : existingPayment.notes,
      },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
    });

    if (
      existingPayment.lease?.tenant?.id &&
      String(existingPayment.status || "").toUpperCase() !== nextStatus
    ) {
      if (nextStatus === "PAID") {
        await createNotification({
          tenantId: existingPayment.lease.tenant.id,
          title: "Payment approved",
          message: `Your payment of $${updatedPayment.amount} has been approved.`,
          type: "SUCCESS",
          category: "PAYMENT",
        });

        await sendPaymentApprovedEmail({
          tenant: updatedPayment.lease.tenant,
          payment: updatedPayment,
          organizationId,
        });
      }

      if (nextStatus === "FAILED") {
        await createNotification({
          tenantId: existingPayment.lease.tenant.id,
          title: "Payment failed",
          message: `Your payment of $${updatedPayment.amount} was marked as failed.`,
          type: "ALERT",
          category: "PAYMENT",
        });
      }
    }

    res.json(updatedPayment);
  } catch (error) {
    console.error("Error updating payment:", error);
    res.status(500).json({
      error: error.message || "Failed to update payment",
    });
  }
});

/* -------------------- DELETE -------------------- */

router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const payment = await prisma.payment.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    await prisma.payment.delete({
      where: { id: req.params.id },
    });

    await removePaymentProofFile(payment);

    res.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Error deleting payment:", error);
    res.status(500).json({
      error: error.message || "Failed to delete payment",
    });
  }
});

module.exports = router;
