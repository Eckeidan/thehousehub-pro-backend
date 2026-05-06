const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "OWNER"));

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

/* GET all contractors */
router.get("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { search = "", isActive, serviceCategory, city } = req.query;

    const where = {
      organizationId,
      AND: [
        search
          ? {
              OR: [
                { companyName: { contains: String(search), mode: "insensitive" } },
                { contactPerson: { contains: String(search), mode: "insensitive" } },
                { email: { contains: String(search), mode: "insensitive" } },
                { phone: { contains: String(search), mode: "insensitive" } },
                { specialties: { contains: String(search), mode: "insensitive" } },
                { serviceCategory: { contains: String(search), mode: "insensitive" } },
                { city: { contains: String(search), mode: "insensitive" } },
              ],
            }
          : {},
        isActive !== undefined && isActive !== ""
          ? { isActive: isActive === "true" }
          : {},
        serviceCategory
          ? {
              serviceCategory: {
                equals: String(serviceCategory),
                mode: "insensitive",
              },
            }
          : {},
        city
          ? { city: { contains: String(city), mode: "insensitive" } }
          : {},
      ],
    };

    const contractors = await prisma.contractor.findMany({
      where,
      orderBy: [{ companyName: "asc" }],
      include: {
        _count: {
          select: {
            maintenanceRequests: true,
          },
        },
      },
    });

    return res.json(contractors);
  } catch (error) {
    console.error("Get contractors error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch contractors" });
  }
});

/* GET contractor stats */
router.get("/stats", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const contractors = await prisma.contractor.findMany({
      where: { organizationId },
      select: {
        id: true,
        isActive: true,
        serviceCategory: true,
      },
    });

    const total = contractors.length;
    const active = contractors.filter((item) => item.isActive).length;
    const inactive = contractors.filter((item) => !item.isActive).length;
    const categorized = contractors.filter((item) => !!item.serviceCategory).length;

    return res.json({
      total,
      active,
      inactive,
      categorized,
    });
  } catch (error) {
    console.error("Contractor stats error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch contractor stats" });
  }
});

/* GET contractor by ID */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const contractor = await prisma.contractor.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
      include: {
        maintenanceRequests: {
          where: { organizationId },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        _count: {
          select: {
            maintenanceRequests: true,
          },
        },
      },
    });

    if (!contractor) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    return res.json(contractor);
  } catch (error) {
    console.error("Get contractor error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch contractor" });
  }
});

/* CREATE contractor */
router.post("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const {
      companyName,
      contactPerson,
      email,
      phone,
      specialties,
      serviceCategory,
      address,
      city,
      baseFee,
      hourlyRate,
      rating,
      isActive,
      notes,
    } = req.body;

    if (!companyName || !String(companyName).trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }

    const contractor = await prisma.contractor.create({
      data: {
        organizationId,
        companyName: String(companyName).trim(),
        contactPerson: contactPerson ? String(contactPerson).trim() : null,
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
        specialties: specialties ? String(specialties).trim() : null,
        serviceCategory: serviceCategory ? String(serviceCategory).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        baseFee:
          baseFee !== undefined && baseFee !== null && baseFee !== ""
            ? Number(baseFee)
            : null,
        hourlyRate:
          hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== ""
            ? Number(hourlyRate)
            : null,
        rating:
          rating !== undefined && rating !== null && rating !== ""
            ? Number(rating)
            : null,
        isActive: typeof isActive === "boolean" ? isActive : true,
        notes: notes ? String(notes).trim() : null,
      },
    });

    return res.status(201).json(contractor);
  } catch (error) {
    console.error("Create contractor error:", error);
    return res.status(500).json({ error: error.message || "Failed to create contractor" });
  }
});

/* UPDATE contractor */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const {
      companyName,
      contactPerson,
      email,
      phone,
      specialties,
      serviceCategory,
      address,
      city,
      baseFee,
      hourlyRate,
      rating,
      isActive,
      notes,
    } = req.body;

    const existing = await prisma.contractor.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    if (!companyName || !String(companyName).trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }

    const contractor = await prisma.contractor.update({
      where: { id: req.params.id },
      data: {
        companyName: String(companyName).trim(),
        contactPerson: contactPerson ? String(contactPerson).trim() : null,
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
        specialties: specialties ? String(specialties).trim() : null,
        serviceCategory: serviceCategory ? String(serviceCategory).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        baseFee:
          baseFee !== undefined && baseFee !== null && baseFee !== ""
            ? Number(baseFee)
            : null,
        hourlyRate:
          hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== ""
            ? Number(hourlyRate)
            : null,
        rating:
          rating !== undefined && rating !== null && rating !== ""
            ? Number(rating)
            : null,
        isActive: typeof isActive === "boolean" ? isActive : existing.isActive,
        notes: notes ? String(notes).trim() : null,
      },
    });

    return res.json(contractor);
  } catch (error) {
    console.error("Update contractor error:", error);
    return res.status(500).json({ error: error.message || "Failed to update contractor" });
  }
});

/* DELETE contractor */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existing = await prisma.contractor.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
      include: {
        _count: {
          select: {
            maintenanceRequests: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    if (existing._count.maintenanceRequests > 0) {
      return res.status(400).json({
        error:
          "This contractor is linked to maintenance requests and cannot be deleted.",
      });
    }

    await prisma.contractor.delete({
      where: { id: req.params.id },
    });

    return res.json({
      success: true,
      message: "Contractor deleted successfully",
    });
  } catch (error) {
    console.error("Delete contractor error:", error);
    return res.status(500).json({ error: error.message || "Failed to delete contractor" });
  }
});

module.exports = router;