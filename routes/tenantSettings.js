const express = require("express");
const bcrypt = require("bcryptjs");

const router = express.Router();

const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(" ").filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  return { firstName, lastName };
}

/**
 * PATCH /api/tenant/settings/profile
 */
router.patch("/profile", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    const tenantId = req.user?.tenantId;

    const { fullName, phone } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: "Full name is required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user || !user.tenant) {
      return res.status(404).json({ error: "Tenant profile not found" });
    }

    const finalTenantId = tenantId || user.tenant.id;
    const { firstName, lastName } = splitFullName(fullName);

    const [updatedUser, updatedTenant] = await Promise.all([
      prisma.user.update({
        where: { id: userId },
        data: {
          fullName: String(fullName).trim(),
        },
      }),

      prisma.tenant.update({
        where: { id: finalTenantId },
        data: {
          firstName,
          lastName,
          phone: phone || null,
        },
      }),
    ]);

    return res.json({
      ok: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        role: updatedUser.role,
      },
      tenant: updatedTenant,
    });
  } catch (error) {
    console.error("Tenant profile settings error:", error);
    return res.status(500).json({ error: "Failed to update tenant profile" });
  }
});

/**
 * PATCH /api/tenant/settings/password
 */
router.patch("/password", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;

    const { currentPassword, newPassword } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Current password and new password are required",
      });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const validPassword = await bcrypt.compare(
      currentPassword,
      user.passwordHash
    );

    if (!validPassword) {
      return res.status(400).json({
        error: "Current password is incorrect",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return res.json({
      ok: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Tenant password settings error:", error);
    return res.status(500).json({ error: "Failed to change password" });
  }
});

module.exports = router;