const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const { requireAuth, requireOwner } = require("../middleware/auth");

const router = express.Router();

/* GET all users - OWNER only */
router.get("/", requireAuth, requireOwner, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json(users);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Failed to load users" });
  }
});

/* CREATE ADMIN or OWNER - OWNER only */
router.post("/", requireAuth, requireOwner, async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password || !role) {
      return res.status(400).json({
        error: "fullName, email, password and role are required",
      });
    }

    const normalizedRole = String(role).trim().toUpperCase();

    if (!["ADMIN", "OWNER"].includes(normalizedRole)) {
      return res.status(400).json({
        error: "Only ADMIN or OWNER can be created here",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email: email.toLowerCase().trim(),
      },
    });

    if (existingUser) {
      return res.status(400).json({
        error: "A user with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: email.toLowerCase().trim(),
        passwordHash: hashedPassword,
        role: normalizedRole,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

module.exports = router;