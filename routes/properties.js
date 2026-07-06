const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

router.use(requireAuth);
router.use(requireRole("ADMIN", "OWNER"));

function clean(value) {
  return value ? String(value).trim() : null;
}

function getPropertyPrefix(propertyType) {
  switch (String(propertyType || "").toUpperCase()) {
    case "APARTMENT":
      return "APT";
    case "HOUSE":
      return "HOUSE";
    case "DUPLEX":
      return "DPX";
    case "COMMERCIAL":
      return "COM";
    case "LAND":
      return "LAND";
    default:
      return "PROP";
  }
}

function cleanCityCode(city) {
  const value =
    String(city || "CITY")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, 8) || "CITY";

  return value;
}

async function generateUniquePropertyCode({ propertyType, city }) {
  const prefix = getPropertyPrefix(propertyType);
  const cityCode = cleanCityCode(city);
  const baseCode = `${prefix}-${cityCode}`;

  let nextNumber = 1;
  let code = "";

  while (true) {
    code = `${baseCode}-${String(nextNumber).padStart(3, "0")}`;

    const existing = await prisma.property.findUnique({
      where: { code },
    });

    if (!existing) return code;

    nextNumber += 1;
  }
}

/* GET ALL PROPERTIES */
router.get("/", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const properties = await prisma.property.findMany({
      where: { organizationId },
      include: {
        tenants: {
          where: { organizationId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isActive: true,
            status: true,
            leaseStatus: true,
          },
        },
        propertyImages: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedProperties = properties.map((property) => {
      const activeTenant = property.tenants.find((tenant) => tenant.isActive);

      return {
        id: property.id,
        code: property.code,
        name: property.name,
        addressLine1: property.addressLine1,
        addressLine2: property.addressLine2,
        city: property.city,
        state: property.state,
        postalCode: property.postalCode,
        country: property.country,
        propertyType: property.propertyType,
        monthlyRent: property.monthlyRent,
        description: property.description,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        areaSqm: property.areaSqm,
        floor: property.floor,
        furnishingStatus: property.furnishingStatus,
        parkingSpaces: property.parkingSpaces,
        availableFrom: property.availableFrom,
        ownerName: property.ownerName,
        occupancyStatus: activeTenant ? "OCCUPIED" : "AVAILABLE",
        isActive: property.isActive,
        organizationId: property.organizationId,
        tenants: property.tenants,
        propertyImages: property.propertyImages,
        isOccupied: !!activeTenant,
        activeTenant: activeTenant || null,
        createdAt: property.createdAt,
        updatedAt: property.updatedAt,
      };
    });

    return res.json(formattedProperties);
  } catch (error) {
    console.error("GET PROPERTIES ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch properties",
    });
  }
});

/* GET SINGLE PROPERTY */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const property = await prisma.property.findFirst({
      where: { id, organizationId },
      include: {
        tenants: {
          where: { organizationId },
          orderBy: { createdAt: "desc" },
        },
        maintenanceRequests: {
          where: { organizationId },
        },
        documents: {
          where: { organizationId },
        },
        rentPayments: true,
        expenses: true,
        incomes: true,
        communications: true,
        propertyImages: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const activeTenant = property.tenants.find((tenant) => tenant.isActive);

    return res.json({
      ...property,
      isOccupied: !!activeTenant,
      occupancyStatus: activeTenant ? "OCCUPIED" : "AVAILABLE",
      activeTenant: activeTenant || null,
    });
  } catch (error) {
    console.error("GET PROPERTY ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch property",
    });
  }
});

/* CREATE PROPERTY */
router.post("/", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const {
      name,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      propertyType,
      purchasePrice,
      currentValue,
      monthlyRent,
      description,
      bedrooms,
      bathrooms,
      areaSqm,
      floor,
      furnishingStatus,
      parkingSpaces,
      availableFrom,
      ownerName,
      notes,
      isActive,
    } = req.body || {};

    if (!addressLine1) {
      return res.status(400).json({
        error: "Address is required",
      });
    }

    const safePropertyType = propertyType || "APARTMENT";

    const propertyCode = await generateUniquePropertyCode({
      propertyType: safePropertyType,
      city,
    });

    const property = await prisma.property.create({
      data: {
        organizationId,
        code: propertyCode,
        name: clean(name),
        addressLine1: String(addressLine1).trim(),
        addressLine2: clean(addressLine2),
        city: clean(city),
        state: clean(state),
        postalCode: clean(postalCode),
        country: clean(country),
        propertyType: safePropertyType,
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
        currentValue: currentValue ? Number(currentValue) : null,
        monthlyRent: monthlyRent ? Number(monthlyRent) : null,
        description: clean(description),
        bedrooms: bedrooms ? Number(bedrooms) : null,
        bathrooms: bathrooms ? Number(bathrooms) : null,
        areaSqm: areaSqm ? Number(areaSqm) : null,
        floor: floor ? Number(floor) : null,
        furnishingStatus: clean(furnishingStatus),
        parkingSpaces: parkingSpaces ? Number(parkingSpaces) : 0,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        ownerName: clean(ownerName),
        occupancyStatus: "AVAILABLE",
        notes: clean(notes),
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    return res.status(201).json(property);
  } catch (error) {
    console.error("CREATE PROPERTY ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to create property",
    });
  }
});

/* UPDATE PROPERTY */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const existingProperty = await prisma.property.findFirst({
      where: { id, organizationId },
    });

    if (!existingProperty) {
      return res.status(404).json({ error: "Property not found" });
    }

    const {
      name,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      propertyType,
      purchasePrice,
      currentValue,
      monthlyRent,
      description,
      bedrooms,
      bathrooms,
      areaSqm,
      floor,
      furnishingStatus,
      parkingSpaces,
      availableFrom,
      ownerName,
      notes,
      isActive,
    } = req.body || {};

    const property = await prisma.property.update({
      where: { id },
      data: {
        name: clean(name),
        addressLine1: addressLine1
          ? String(addressLine1).trim()
          : existingProperty.addressLine1,
        addressLine2: clean(addressLine2),
        city: clean(city),
        state: clean(state),
        postalCode: clean(postalCode),
        country: clean(country),
        propertyType: propertyType || existingProperty.propertyType,
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
        currentValue: currentValue ? Number(currentValue) : null,
        monthlyRent: monthlyRent ? Number(monthlyRent) : null,
        description: clean(description),
        bedrooms: bedrooms ? Number(bedrooms) : null,
        bathrooms: bathrooms ? Number(bathrooms) : null,
        areaSqm: areaSqm ? Number(areaSqm) : null,
        floor: floor ? Number(floor) : null,
        furnishingStatus: clean(furnishingStatus),
        parkingSpaces: parkingSpaces ? Number(parkingSpaces) : 0,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        ownerName: clean(ownerName),
        notes: clean(notes),
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    return res.json(property);
  } catch (error) {
    console.error("UPDATE PROPERTY ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to update property",
    });
  }
});

/* DELETE PROPERTY */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const existingProperty = await prisma.property.findFirst({
      where: { id, organizationId },
    });

    if (!existingProperty) {
      return res.status(404).json({ error: "Property not found" });
    }

    await prisma.property.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: "Property deleted successfully",
    });
  } catch (error) {
    console.error("DELETE PROPERTY ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to delete property",
    });
  }
});

module.exports = router;