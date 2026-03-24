const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

function generateNextUnitCode(propertyCode, existingUnitCodes = []) {
  const prefix = `${propertyCode}-U`;

  const numbers = existingUnitCodes
    .filter((code) => typeof code === "string" && code.startsWith(prefix))
    .map((code) => {
      const match = code.match(/-U(\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((num) => !Number.isNaN(num));

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

  return `${prefix}${String(nextNumber).padStart(2, "0")}`;
}

function sanitizePropertyCode(code) {
  return String(code || "UNIT")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase();
}

function generateNextUnitCode(propertyCode, existingUnitCodes = []) {
  const safePropertyCode = sanitizePropertyCode(propertyCode);
  const prefix = `${safePropertyCode}-U`;

  const numbers = existingUnitCodes
    .filter((code) => typeof code === "string" && code.startsWith(prefix))
    .map((code) => {
      const match = code.match(/-U(\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((num) => !Number.isNaN(num));

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

  return `${prefix}${String(nextNumber).padStart(2, "0")}`;
}

/* =========================
   GET /api/units
   ========================= */
router.get("/", async (req, res) => {
  try {
    const { propertyId, occupancyStatus, search } = req.query;

    const where = {
      ...(propertyId ? { propertyId } : {}),
      ...(occupancyStatus ? { occupancyStatus } : {}),
      ...(search
        ? {
            OR: [
              { unitCode: { contains: search, mode: "insensitive" } },
              { unitName: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } },
              {
                property: {
                  OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                    { addressLine1: { contains: search, mode: "insensitive" } },
                    { city: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const units = await prisma.unit.findMany({
      where,
      include: {
        property: true,
      },
      orderBy: [
        { propertyId: "asc" },
        { unitCode: "asc" },
      ],
    });

    res.json(units);
  } catch (error) {
    console.error("Error fetching units:", error);
    res.status(500).json({ error: "Failed to fetch units" });
  }
});

/* =========================
   GET /api/units/stats
   ========================= */
router.get("/stats", async (req, res) => {
  try {
    const [total, available, occupied, inactive] = await Promise.all([
      prisma.unit.count(),
      prisma.unit.count({ where: { occupancyStatus: "AVAILABLE", isActive: true } }),
      prisma.unit.count({ where: { occupancyStatus: "OCCUPIED", isActive: true } }),
      prisma.unit.count({ where: { isActive: false } }),
    ]);

    res.json({
      total,
      available,
      occupied,
      inactive,
    });
  } catch (error) {
    console.error("Error fetching unit stats:", error);
    res.status(500).json({ error: "Failed to fetch unit stats" });
  }
});

/* =========================
   GET /api/units/:id
   ========================= */
router.get("/:id", async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        property: true,
      },
    });

    if (!unit) {
      return res.status(404).json({ error: "Unit not found" });
    }

    res.json(unit);
  } catch (error) {
    console.error("Error fetching unit:", error);
    res.status(500).json({ error: "Failed to fetch unit" });
  }
});

/* =========================
   POST /api/units
   ========================= */
router.post("/", async (req, res) => {
  try {
    const {
      propertyId,
      unitName,
      floor,
      bedrooms,
      bathrooms,
      areaSqm,
      monthlyRent,
      occupancyStatus,
      isActive,
      notes,
    } = req.body || {};

    if (!propertyId || String(propertyId).trim() === "") {
      return res.status(400).json({ error: "Property is required" });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const existingUnits = await prisma.unit.findMany({
      where: { propertyId },
      select: { unitCode: true },
    });

    const finalUnitCode = generateNextUnitCode(
      property.code,
      existingUnits.map((u) => u.unitCode)
    );

    const existingUnit = await prisma.unit.findFirst({
      where: {
        propertyId,
        unitCode: finalUnitCode,
      },
    });

    if (existingUnit) {
      return res.status(400).json({
        error: "A unit with this code already exists for this property",
      });
    }

    const unit = await prisma.unit.create({
      data: {
        propertyId,
        unitCode: finalUnitCode,
        unitName: unitName ? String(unitName).trim() : null,
        floor:
          floor !== undefined && floor !== null && floor !== ""
            ? Number(floor)
            : null,
        bedrooms:
          bedrooms !== undefined && bedrooms !== null && bedrooms !== ""
            ? Number(bedrooms)
            : null,
        bathrooms:
          bathrooms !== undefined && bathrooms !== null && bathrooms !== ""
            ? Number(bathrooms)
            : null,
        areaSqm:
          areaSqm !== undefined && areaSqm !== null && areaSqm !== ""
            ? areaSqm.toString()
            : null,
        monthlyRent:
          monthlyRent !== undefined && monthlyRent !== null && monthlyRent !== ""
            ? monthlyRent.toString()
            : null,
        occupancyStatus: occupancyStatus || "AVAILABLE",
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        notes: notes ? String(notes).trim() : null,
      },
      include: {
        property: true,
      },
    });

    res.status(201).json(unit);
  } catch (error) {
    console.error("Error creating unit:", error);
    res.status(500).json({ error: error.message || "Failed to create unit" });
  }
});

/* =========================
   PUT /api/units/:id
   ========================= */
router.put("/:id", async (req, res) => {
  try {
    const {
      propertyId,
      unitCode,
      unitName,
      floor,
      bedrooms,
      bathrooms,
      areaSqm,
      monthlyRent,
      occupancyStatus,
      isActive,
      notes,
    } = req.body || {};

    const existing = await prisma.unit.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Unit not found" });
    }

    if (propertyId) {
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
      });

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
    }

    const nextPropertyId = propertyId || existing.propertyId;
    const nextUnitCode =
      unitCode !== undefined ? String(unitCode).trim() : existing.unitCode;

    const duplicate = await prisma.unit.findFirst({
      where: {
        propertyId: nextPropertyId,
        unitCode: nextUnitCode,
        NOT: {
          id: req.params.id,
        },
      },
    });

    if (duplicate) {
      return res.status(400).json({
        error: "Another unit with this code already exists for this property",
      });
    }

    const unit = await prisma.unit.update({
      where: { id: req.params.id },
      data: {
        ...(propertyId !== undefined ? { propertyId } : {}),
        ...(unitCode !== undefined ? { unitCode: String(unitCode).trim() } : {}),
        ...(unitName !== undefined
          ? { unitName: unitName ? String(unitName).trim() : null }
          : {}),
        ...(floor !== undefined
          ? {
              floor:
                floor !== null && floor !== "" ? Number(floor) : null,
            }
          : {}),
        ...(bedrooms !== undefined
          ? {
              bedrooms:
                bedrooms !== null && bedrooms !== "" ? Number(bedrooms) : null,
            }
          : {}),
        ...(bathrooms !== undefined
          ? {
              bathrooms:
                bathrooms !== null && bathrooms !== ""
                  ? Number(bathrooms)
                  : null,
            }
          : {}),
        ...(areaSqm !== undefined
          ? {
              areaSqm:
                areaSqm !== null && areaSqm !== "" ? areaSqm.toString() : null,
            }
          : {}),
        ...(monthlyRent !== undefined
          ? {
              monthlyRent:
                monthlyRent !== null && monthlyRent !== ""
                  ? monthlyRent.toString()
                  : null,
            }
          : {}),
        ...(occupancyStatus !== undefined ? { occupancyStatus } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        ...(notes !== undefined
          ? { notes: notes ? String(notes).trim() : null }
          : {}),
      },
      include: {
        property: true,
      },
    });

    res.json(unit);
  } catch (error) {
    console.error("Error updating unit:", error);
    res.status(500).json({ error: error.message || "Failed to update unit" });
  }
});

/* =========================
   DELETE /api/units/:id
   ========================= */
router.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.unit.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Unit not found" });
    }

    await prisma.unit.delete({
      where: { id: req.params.id },
    });

    res.json({ message: "Unit deleted successfully" });
  } catch (error) {
    console.error("Error deleting unit:", error);
    res.status(500).json({ error: "Failed to delete unit" });
  }
});

module.exports = router;