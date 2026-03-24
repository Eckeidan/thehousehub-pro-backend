const prisma = require("../lib/prisma");

async function createNotification({
  tenantId = null,
  title,
  message,
  type = "INFO",
  category = "SYSTEM",
}) {
  try {
    if (!tenantId || !title || !message) return null;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        user: true,
      },
    });

    if (!tenant || !tenant.user) {
      return null;
    }

    return await prisma.notification.create({
      data: {
        userId: tenant.user.id,
        tenantId: tenant.id,
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