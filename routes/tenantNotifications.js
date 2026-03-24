const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/tenant/notifications
 */
router.get("/tenant/notifications", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (String(user.role || "").toUpperCase() !== "TENANT") {
      return res.status(403).json({ error: "Access denied" });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        OR: [
          { userId: user.id },
          ...(user.tenantId ? [{ tenantId: user.tenantId }] : []),
        ],
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(notifications);
  } catch (error) {
    console.error("GET tenant notifications error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load tenant notifications",
    });
  }
});

/**
 * PATCH /api/tenant/notifications/read-all
 */
router.patch("/tenant/notifications/read-all", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (String(user.role || "").toUpperCase() !== "TENANT") {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await prisma.notification.updateMany({
      where: {
        isRead: false,
        OR: [
          { userId: user.id },
          ...(user.tenantId ? [{ tenantId: user.tenantId }] : []),
        ],
      },
      data: {
        isRead: true,
      },
    });

    return res.json({
      message: "All notifications marked as read",
      updatedCount: result.count,
    });
  } catch (error) {
    console.error("PATCH read-all notifications error:", error);
    return res.status(500).json({
      error: error.message || "Failed to mark all notifications as read",
    });
  }
});

/**
 * PATCH /api/tenant/notifications/:id/read
 */
router.patch("/tenant/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (String(user.role || "").toUpperCase() !== "TENANT") {
      return res.status(403).json({ error: "Access denied" });
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        OR: [
          { userId: user.id },
          ...(user.tenantId ? [{ tenantId: user.tenantId }] : []),
        ],
      },
    });

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("PATCH tenant notification read error:", error);
    return res.status(500).json({
      error: error.message || "Failed to mark notification as read",
    });
  }
});

module.exports = router;