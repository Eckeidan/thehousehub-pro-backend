const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function buildRedirectPath(role) {
  switch (String(role || "").trim().toUpperCase()) {
    case "SUPER_OWNER":
      return "/super-owner";
    case "ADMIN":
      return "/dashboard";
    case "OWNER":
      return "/owner";
    case "TENANT":
      return "/tenant";
    default:
      return "/";
  }
}

router.get("/test", (req, res) => {
  res.json({ message: "Auth route works" });
});

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: String(email).toLowerCase().trim(),
      },
      include: {
        tenant: {
          include: {
            property: true,
            unit: true,
            leases: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: "Account is inactive",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId || null,
        organizationId: user.organizationId || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        tenantId: user.tenantId || null,
        organizationId: user.organizationId || null,
        mustChangePassword: user.mustChangePassword === true,
        platformAccessAll: user.platformAccessAll === true,
        platformPermissions: user.platformPermissions || [],
      },
      redirectTo: buildRedirectPath(user.role),
    });
  } catch (error) {
    console.error("Login error full:", error);
    return res.status(500).json({
      error: error.message || "Login failed",
    });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.user.userId,
      },
      include: {
        tenant: {
          include: {
            property: true,
            unit: true,
            leases: {
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    return res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        tenantId: user.tenantId || null,
        organizationId: user.organizationId || null,
        mustChangePassword: user.mustChangePassword === true,
        platformAccessAll: user.platformAccessAll === true,
        platformPermissions: user.platformPermissions || [],
        tenant: user.tenant || null,
      },
    });
  } catch (error) {
    console.error("Auth me error:", error);
    return res.status(500).json({
      error: "Failed to fetch user",
    });
  }
});

/**
 * PUT /api/auth/change-password
 */
router.put("/change-password", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        error: "New password and confirmation are required",
      });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: "New password and confirmation do not match",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.mustChangePassword) {
      if (!currentPassword) {
        return res.status(400).json({
          error: "Current password is required",
        });
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
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
      },
    });

    return res.json({
      success: true,
      message: "Password changed successfully",
      mustChangePassword: false,
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      error: error.message || "Failed to change password",
    });
  }
});

module.exports = router;
