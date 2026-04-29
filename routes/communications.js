const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");
const { requireAuth, requireAdminOrOwner } = require("../middleware/auth");

// GET conversations
router.get("/", requireAuth, requireAdminOrOwner, async (req, res) => {
  try {
    const conversations = await prisma.communication.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        tenant: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        property: {
          select: {
            name: true,
          },
        },
      },
    });

    res.json(conversations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

module.exports = router;