const express = require("express");
const bcrypt = require("bcryptjs");
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

/**
 * POST /api/tenants/:id/create-account
 * Create login account for a tenant
 */
router.post(
  "/:id/create-account",
  requireAuth,
  requireRole("ADMIN", "OWNER"),
  async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters.",
      });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: { user: true },
    });

    if (!tenant) {
      return res.status(404).json({
        error: "Tenant not found.",
      });
    }

    if (tenant.user) {
      return res.status(400).json({
        error: "This tenant already has an account.",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (existingUser) {
      return res.status(400).json({
        error: "This email is already used by another account.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const defaultFullName =
      fullName?.trim() ||
      `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim() ||
      "Tenant User";

    const user = await prisma.user.create({
      data: {
        fullName: defaultFullName,
        email: email.trim().toLowerCase(),
        passwordHash,
        role: "TENANT",
        tenantId: tenant.id,
        organizationId,
        isActive: true,
      },
    });

    // optional: also update tenant email if empty
    if (!tenant.email) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          email: email.trim().toLowerCase(),
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: "Tenant account created successfully.",
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
    });
  } catch (error) {
    console.error("Create tenant account error:", error);
    return res.status(500).json({
      error: "Failed to create tenant account.",
    });
  }
});

module.exports = router;
