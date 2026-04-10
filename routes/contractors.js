const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

/* GET all contractors */
router.get("/", async (req, res) => {
  try {
    const { search = "", isActive, serviceCategory, city } = req.query;

    const where = {
      AND: [
        search
          ? {
              OR: [
                { companyName: { contains: search, mode: "insensitive" } },
                { contactPerson: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { specialties: { contains: search, mode: "insensitive" } },
                { serviceCategory: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
        isActive !== undefined && isActive !== ""
          ? { isActive: isActive === "true" }
          : {},
        serviceCategory
          ? { serviceCategory: { equals: serviceCategory, mode: "insensitive" } }
          : {},
        city ? { city: { contains: city, mode: "insensitive" } } : {},
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

    res.json(contractors);
  } catch (error) {
    console.error("Get contractors error:", error);
    res.status(500).json({ error: "Failed to fetch contractors" });
  }
});

/* GET contractor stats */
router.get("/stats", async (req, res) => {
  try {
    const contractors = await prisma.contractor.findMany({
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

    res.json({
      total,
      active,
      inactive,
      categorized,
    });
  } catch (error) {
    console.error("Contractor stats error:", error);
    res.status(500).json({ error: "Failed to fetch contractor stats" });
  }
});

/* GET contractor by ID */
router.get("/:id", async (req, res) => {
  try {
    const contractor = await prisma.contractor.findUnique({
      where: { id: req.params.id },
      include: {
        maintenanceRequests: {
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

    res.json(contractor);
  } catch (error) {
    console.error("Get contractor error:", error);
    res.status(500).json({ error: "Failed to fetch contractor" });
  }
});

/* CREATE contractor */
router.post("/", async (req, res) => {
  try {
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

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }

    const contractor = await prisma.contractor.create({
      data: {
        companyName: companyName.trim(),
        contactPerson: contactPerson?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        specialties: specialties?.trim() || null,
        serviceCategory: serviceCategory?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
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
        notes: notes?.trim() || null,
      },
    });

    res.status(201).json(contractor);
  } catch (error) {
    console.error("Create contractor error:", error);
    res.status(500).json({ error: "Failed to create contractor" });
  }
});

/* UPDATE contractor */
router.put("/:id", async (req, res) => {
  try {
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

    const existing = await prisma.contractor.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Contractor not found" });
    }

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }

    const contractor = await prisma.contractor.update({
      where: { id: req.params.id },
      data: {
        companyName: companyName.trim(),
        contactPerson: contactPerson?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        specialties: specialties?.trim() || null,
        serviceCategory: serviceCategory?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
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
        notes: notes?.trim() || null,
      },
    });

    res.json(contractor);
  } catch (error) {
    console.error("Update contractor error:", error);
    res.status(500).json({ error: "Failed to update contractor" });
  }
});

/* DELETE contractor */
router.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.contractor.findUnique({
      where: { id: req.params.id },
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

    res.json({ success: true, message: "Contractor deleted successfully" });
  } catch (error) {
    console.error("Delete contractor error:", error);
    res.status(500).json({ error: "Failed to delete contractor" });
  }
});

module.exports = router;