const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

/* GET settings */
router.get("/", async (req, res) => {
  try {
    let settings = await prisma.appSetting.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!settings) {
      settings = await prisma.appSetting.create({
        data: {},
      });
    }

    res.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

/* UPDATE settings */
router.put("/", async (req, res) => {
  try {
    let settings = await prisma.appSetting.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!settings) {
      settings = await prisma.appSetting.create({
        data: {},
      });
    }

    const updated = await prisma.appSetting.update({
      where: { id: settings.id },
      data: {
        companyName: req.body.companyName ?? settings.companyName,
        email: req.body.email ?? settings.email,
        currency: req.body.currency ?? settings.currency,
        timezone: req.body.timezone ?? settings.timezone,
        tenantAccessDefault:
          req.body.tenantAccessDefault ?? settings.tenantAccessDefault,
        notifications: req.body.notifications ?? settings.notifications,
        maintenanceAlerts:
          req.body.maintenanceAlerts ?? settings.maintenanceAlerts,
        leaseReminders: req.body.leaseReminders ?? settings.leaseReminders,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

module.exports = router;