const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function buildRedirectPath(role) {
  switch (String(role || "").trim().toUpperCase()) {
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

    console.log("EMAIL INPUT:", email);
    console.log("PASSWORD INPUT:", password);

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: email.toLowerCase().trim(),
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

    console.log("USER FOUND:", user ? user.email : null);
    console.log("ROLE:", user ? user.role : null);
    console.log("HASH IN DB:", user ? user.passwordHash : null);

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

    console.log("PASSWORD VALID:", isPasswordValid);

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
      },
      process.env.JWT_SECRET || "propertyos_dev_secret",
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
        tenantId: user.tenantId || null,
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
        tenantId: user.tenantId,
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
 * POST /api/auth/logout
 */
router.post("/logout", requireAuth, async (req, res) => {
  return res.json({
    message: "Logout successful",
  });
});

module.exports = router;