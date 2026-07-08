const prisma = require("../lib/prisma");

async function createNotification({
  userId = null,
  tenantId = null,
  title,
  message,
  type = "INFO",
  category = "SYSTEM",
}) {
  try {
    if (!title || !message) return null;

    let targetUserId = userId;
    let targetTenantId = tenantId;

    if (!targetUserId) {
      if (!tenantId) return null;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          user: true,
        },
      });

      if (!tenant || !tenant.user) {
        return null;
      }

      targetUserId = tenant.user.id;
      targetTenantId = tenant.id;
    }

    return await prisma.notification.create({
      data: {
        userId: targetUserId,
        tenantId: targetTenantId,
        title,
        message,
        type,
        category,
        isRead: false,
      },
    });
  } catch (error) {
    console.error("createNotification error:", error);
    return null;
  }
}

module.exports = { createNotification };
