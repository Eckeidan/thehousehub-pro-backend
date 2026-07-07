const express = require("express");
const prisma = require("../lib/prisma");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "OWNER"));

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

function generatePassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$!";
  let password = "";

  for (let i = 0; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  return password;
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

function formatDate(value) {
  if (!value) return "N/A";

  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "2-digit",
    });
  } catch {
    return "N/A";
  }
}

function formatMoney(value) {
  if (value === null || value === undefined) return "N/A";

  const amount = Number(value);

  if (Number.isNaN(amount)) return "N/A";

  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function sendTenantWelcomeEmail({
  to,
  fullName,
  password,
  property,
  leaseStartDate,
  leaseEndDate,
  monthlyRent,
}) {
  const appUrl = process.env.FRONTEND_URL || "https://thehousehub.app/login";
  const brandName = process.env.EMAIL_BRAND_NAME || "The House Hub";
  const logoUrl = process.env.EMAIL_LOGO_URL || "";
  const transporter = createTransporter();

  const propertyName = property?.name || property?.code || "Assigned property";
  const propertyAddress = [
    property?.addressLine1,
    property?.city,
    property?.state,
    property?.country,
  ]
    .filter(Boolean)
    .join(", ");

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"${brandName}" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your ${brandName} tenant account is ready`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:24px;">
        <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="background:linear-gradient(90deg,#1f3270,#45C9B5);padding:26px;color:#ffffff;">
            ${
              logoUrl
                ? `<img src="${logoUrl}" alt="${brandName}" style="height:46px;margin-bottom:14px;" />`
                : ""
            }
            <h2 style="margin:0;font-size:24px;">Welcome to ${brandName}</h2>
            <p style="margin:8px 0 0;opacity:.9;">Your tenant account has been created.</p>
          </div>

          <div style="padding:28px;color:#111827;">
            <p>Hello <strong>${fullName}</strong>,</p>
            <p>Your tenant portal account is ready. Use the information below to login.</p>

            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin:22px 0;">
              <p><strong>Login URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
              <p><strong>Email:</strong> ${to}</p>
              <p><strong>Temporary Password:</strong> ${password}</p>
              <p><strong>Role:</strong> Tenant</p>
            </div>

            <h3 style="margin:24px 0 10px;color:#1f3270;">Your rental information</h3>

            <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin-bottom:22px;">
              <p><strong>Property:</strong> ${propertyName}</p>
              <p><strong>Address:</strong> ${propertyAddress || "N/A"}</p>
              <p><strong>Lease Start:</strong> ${formatDate(leaseStartDate)}</p>
              <p><strong>Lease End:</strong> ${formatDate(leaseEndDate)}</p>
              <p><strong>Monthly Payment:</strong> ${formatMoney(monthlyRent)}</p>
            </div>

            <div style="text-align:center;margin-top:26px;">
              <a href="${appUrl}"
                style="display:inline-block;background:#2563eb;color:#ffffff;padding:13px 24px;border-radius:12px;text-decoration:none;font-weight:bold;">
                Login Now
              </a>
            </div>

            <p style="margin-top:22px;color:#6b7280;font-size:13px;">
              For security, please change your temporary password after your first login.
            </p>
          </div>

          <div style="background:#f1f5f9;padding:16px;text-align:center;color:#64748b;font-size:12px;">
            © ${new Date().getFullYear()} ${brandName}. All rights reserved.
          </div>
        </div>
      </div>
    `,
  });
}

async function sendTenantPasswordResetEmail({ to, fullName, password }) {
  const appUrl = process.env.FRONTEND_URL || "https://thehousehub.app/login";
  const brandName = process.env.EMAIL_BRAND_NAME || "The House Hub";
  const transporter = createTransporter();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"${brandName}" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your ${brandName} tenant password was reset`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:24px;">
        <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="background:linear-gradient(90deg,#1f3270,#45C9B5);padding:26px;color:#ffffff;">
            <h2 style="margin:0;font-size:24px;">Tenant password reset</h2>
            <p style="margin:8px 0 0;opacity:.9;">A new temporary password has been generated.</p>
          </div>
          <div style="padding:28px;color:#111827;">
            <p>Hello <strong>${fullName}</strong>,</p>
            <p>Your tenant portal password was reset by your property administrator.</p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin:22px 0;">
              <p><strong>Login URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
              <p><strong>Email:</strong> ${to}</p>
              <p><strong>Temporary Password:</strong> ${password}</p>
            </div>
            <p style="margin-top:22px;color:#6b7280;font-size:13px;">
              For security, please change this temporary password after login.
            </p>
          </div>
        </div>
      </div>
    `,
  });
}

/* GET all tenants */
router.get("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenants = await prisma.tenant.findMany({
      where: { organizationId },
      include: {
        property: true,
        unit: true,
        user: true,
        leases: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(tenants);
  } catch (error) {
    console.error("Error fetching tenants:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch tenants",
    });
  }
});

/* GET one tenant by id */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: {
        property: true,
        unit: true,
        user: true,
        leases: { orderBy: { createdAt: "desc" } },
        maintenanceRequests: true,
        documents: true,
      },
    });

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    return res.json(tenant);
  } catch (error) {
    console.error("Error fetching tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch tenant",
    });
  }
});

/* CREATE tenant */
router.post("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const {
      firstName,
      lastName,
      email,
      phone,
      propertyId,
      unitId,
      leaseStart,
      leaseEnd,
      status,
      emergencyContactName,
      emergencyContactPhone,
      notes,
    } = req.body || {};

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "First name and last name are required" });
    }

    if (!propertyId) {
      return res.status(400).json({ error: "Property is required" });
    }

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found in your organization" });
    }

    const existingActiveTenant = await prisma.tenant.findFirst({
      where: { organizationId, propertyId, isActive: true },
    });

    if (existingActiveTenant && status !== "INACTIVE") {
      return res.status(400).json({ error: "This property already has an active tenant" });
    }

    const finalStatus = status || "ACTIVE";
    const isActive = finalStatus !== "INACTIVE";

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          organizationId,
          propertyId,
          unitId: unitId || null,
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          email: email ? String(email).trim().toLowerCase() : null,
          phone: phone ? String(phone).trim() : null,
          emergencyContactName: emergencyContactName ? String(emergencyContactName).trim() : null,
          emergencyContactPhone: emergencyContactPhone ? String(emergencyContactPhone).trim() : null,
          leaseStartDate: leaseStart ? new Date(leaseStart) : null,
          leaseEndDate: leaseEnd ? new Date(leaseEnd) : null,
          leaseStatus: isActive ? "ACTIVE" : "TERMINATED",
          status: finalStatus,
          isActive,
          monthlyRent: property.monthlyRent || null,
          notes: notes ? String(notes).trim() : null,
        },
      });

      await tx.property.update({
        where: { id: propertyId },
        data: { occupancyStatus: isActive ? "OCCUPIED" : "AVAILABLE" },
      });

      const fullTenant = await tx.tenant.findFirst({
        where: { id: tenant.id, organizationId },
        include: {
          property: true,
          unit: true,
          user: true,
          leases: true,
          maintenanceRequests: true,
        },
      });

      return { tenant: fullTenant };
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error("Error creating tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to create tenant",
    });
  }
});

/* CREATE tenant login account */
router.post("/:id/create-account", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const { email, password, fullName } = req.body || {};

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: {
        user: true,
        property: true,
        unit: true,
      },
    });

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    if (tenant.user) {
      return res.status(400).json({ error: "This tenant already has an account" });
    }

    const finalEmail = email || tenant.email;

    if (!finalEmail || !String(finalEmail).trim()) {
      return res.status(400).json({
        error: "Tenant email is required before creating account",
      });
    }

    const cleanEmail = String(finalEmail).trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      return res.status(400).json({
        error: "This email is already used by another account",
      });
    }

    const temporaryPassword =
      password && String(password).length >= 6 ? String(password) : generatePassword();

    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const createdUser = await prisma.user.create({
      data: {
        organizationId,
        fullName:
          fullName?.trim() ||
          `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim(),
        email: cleanEmail,
        passwordHash,
        role: "TENANT",
        isActive: true,
        mustChangePassword: true,
        tenantId: tenant.id,
      },
    });

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { email: cleanEmail },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    await sendTenantWelcomeEmail({
      to: cleanEmail,
      fullName: createdUser.fullName,
      password: temporaryPassword,
      property: tenant.property,
      leaseStartDate: tenant.leaseStartDate,
      leaseEndDate: tenant.leaseEndDate,
      monthlyRent: tenant.monthlyRent,
    });

    return res.status(201).json({
      message: "Tenant account created successfully and email sent",
      user: {
        id: createdUser.id,
        fullName: createdUser.fullName,
        email: createdUser.email,
        role: createdUser.role,
        organizationId: createdUser.organizationId,
        mustChangePassword: createdUser.mustChangePassword,
      },
      tenant: updatedTenant,
    });
  } catch (error) {
    console.error("Error creating tenant account:", error);
    return res.status(500).json({
      error: error.message || "Failed to create tenant account",
    });
  }
});

/* RESET tenant login password */
router.post("/:id/reset-password", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: {
        user: true,
        property: true,
      },
    });

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    if (!tenant.user) {
      return res.status(400).json({
        error: "This tenant does not have a portal account yet",
      });
    }

    const temporaryPassword = generatePassword(12);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const updatedUser = await prisma.user.update({
      where: { id: tenant.user.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        tenantId: true,
        organizationId: true,
        mustChangePassword: true,
        isActive: true,
      },
    });

    let emailSent = false;

    try {
      await sendTenantPasswordResetEmail({
        to: updatedUser.email,
        fullName: updatedUser.fullName,
        password: temporaryPassword,
      });
      emailSent = true;
    } catch (emailError) {
      console.error("Tenant password reset email error:", emailError);
    }

    return res.json({
      message: emailSent
        ? "Tenant password reset successfully and email sent"
        : "Tenant password reset successfully. Email delivery failed.",
      emailSent,
      password: temporaryPassword,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error resetting tenant password:", error);
    return res.status(500).json({
      error: error.message || "Failed to reset tenant password",
    });
  }
});

/* MOVE OUT tenant */
router.patch("/:id/move-out", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const existingTenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: { property: true, unit: true },
    });

    if (!existingTenant) return res.status(404).json({ error: "Tenant not found" });

    const updatedTenant = await prisma.tenant.update({
      where: { id },
      data: {
        status: "INACTIVE",
        isActive: false,
        leaseStatus: "TERMINATED",
      },
      include: { property: true, unit: true, user: true },
    });

    if (existingTenant.propertyId) {
      const remainingActiveTenant = await prisma.tenant.findFirst({
        where: {
          organizationId,
          propertyId: existingTenant.propertyId,
          isActive: true,
          id: { not: id },
        },
      });

      if (!remainingActiveTenant) {
        await prisma.property.update({
          where: { id: existingTenant.propertyId },
          data: { occupancyStatus: "AVAILABLE" },
        });
      }
    }

    await prisma.lease.updateMany({
      where: { organizationId, tenantId: id, status: "ACTIVE" },
      data: { status: "TERMINATED" },
    });

    return res.json({
      message: "Tenant moved out successfully",
      tenant: updatedTenant,
    });
  } catch (error) {
    console.error("Move out error:", error);
    return res.status(500).json({
      error: error.message || "Failed to move out tenant",
    });
  }
});

/* DELETE tenant */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: { property: true, unit: true, user: true },
    });

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    await prisma.$transaction(async (tx) => {
      if (tenant.user?.id) {
        await tx.user.delete({ where: { id: tenant.user.id } });
      }

      await tx.tenant.delete({ where: { id } });

      if (tenant.propertyId) {
        const remainingActiveTenant = await tx.tenant.findFirst({
          where: {
            organizationId,
            propertyId: tenant.propertyId,
            isActive: true,
          },
        });

        if (!remainingActiveTenant) {
          await tx.property.update({
            where: { id: tenant.propertyId },
            data: { occupancyStatus: "AVAILABLE" },
          });
        }
      }
    });

    return res.json({ message: "Tenant deleted successfully" });
  } catch (error) {
    console.error("Error deleting tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to delete tenant",
    });
  }
});

/* UPDATE tenant */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const {
      propertyId,
      unitId,
      firstName,
      lastName,
      email,
      phone,
      leaseStartDate,
      leaseEndDate,
      emergencyContactName,
      emergencyContactPhone,
      status,
      notes,
    } = req.body || {};

    const existingTenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: { property: true, unit: true, user: true },
    });

    if (!existingTenant) return res.status(404).json({ error: "Tenant not found" });

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "First name and last name are required" });
    }

    if (!propertyId) {
      return res.status(400).json({ error: "Property is required" });
    }

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId },
    });

    if (!property) return res.status(404).json({ error: "Selected property not found" });

    const conflictingTenant = await prisma.tenant.findFirst({
      where: {
        organizationId,
        id: { not: id },
        isActive: true,
        propertyId,
      },
    });

    if (conflictingTenant && status !== "INACTIVE") {
      return res.status(400).json({
        error: "This property already has another active tenant.",
      });
    }

    const finalStatus = status || "ACTIVE";
    const isActive = finalStatus !== "INACTIVE";

    const updatedTenant = await prisma.tenant.update({
      where: { id },
      data: {
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: email ? String(email).trim().toLowerCase() : null,
        phone: phone ? String(phone).trim() : null,
        leaseStartDate: leaseStartDate ? new Date(leaseStartDate) : null,
        leaseEndDate: leaseEndDate ? new Date(leaseEndDate) : null,
        emergencyContactName: emergencyContactName ? String(emergencyContactName).trim() : null,
        emergencyContactPhone: emergencyContactPhone ? String(emergencyContactPhone).trim() : null,
        status: finalStatus,
        isActive,
        leaseStatus: isActive ? "ACTIVE" : "TERMINATED",
        notes: notes ? String(notes).trim() : null,
        propertyId,
        unitId: unitId || null,
        monthlyRent: property.monthlyRent || null,
      },
      include: { property: true, unit: true, user: true },
    });

    if (existingTenant.user?.id) {
      await prisma.user.update({
        where: { id: existingTenant.user.id },
        data: {
          ...(email ? { email: String(email).trim().toLowerCase() } : {}),
          fullName: `${firstName} ${lastName}`.trim(),
        },
      });
    }

    if (existingTenant.propertyId && existingTenant.propertyId !== propertyId) {
      const oldPropertyActiveTenant = await prisma.tenant.findFirst({
        where: {
          organizationId,
          isActive: true,
          propertyId: existingTenant.propertyId,
        },
      });

      if (!oldPropertyActiveTenant) {
        await prisma.property.update({
          where: { id: existingTenant.propertyId },
          data: { occupancyStatus: "AVAILABLE" },
        });
      }
    }

    await prisma.property.update({
      where: { id: propertyId },
      data: { occupancyStatus: isActive ? "OCCUPIED" : "AVAILABLE" },
    });

    return res.json(updatedTenant);
  } catch (error) {
    console.error("Error updating tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to update tenant",
    });
  }
});

module.exports = router;
