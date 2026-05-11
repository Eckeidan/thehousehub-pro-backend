const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

router.use(requireAuth);
router.use(requireRole("ADMIN", "OWNER"));

/* =========================================================
   GET ALL PROPERTIES
========================================================= */
router.get("/", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return res
        .status(403)
        .json({ error: "Organization is required" });
    }

    const properties = await prisma.property.findMany({
      where: {
        organizationId,
      },
      include: {
        tenants: {
          where: {
            organizationId,
          },
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
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedProperties = properties.map((property) => {
      const activeTenant = property.tenants.find(
        (tenant) => tenant.isActive
      );

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

        occupancyStatus: activeTenant
          ? "OCCUPIED"
          : "AVAILABLE",

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

/* =========================================================
   GET SINGLE PROPERTY
========================================================= */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res
        .status(403)
        .json({ error: "Organization is required" });
    }

    const property = await prisma.property.findFirst({
      where: {
        id,
        organizationId,
      },

      include: {
        tenants: {
          where: {
            organizationId,
          },

          orderBy: {
            createdAt: "desc",
          },
        },

        maintenanceRequests: {
          where: {
            organizationId,
          },
        },

        documents: {
          where: {
            organizationId,
          },
        },

        rentPayments: true,

        expenses: true,

        incomes: true,

        communications: true,

        propertyImages: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    });

    if (!property) {
      return res.status(404).json({
        error: "Property not found",
      });
    }

    const activeTenant = property.tenants.find(
      (tenant) => tenant.isActive
    );

    return res.json({
      ...property,

      isOccupied: !!activeTenant,

      occupancyStatus: activeTenant
        ? "OCCUPIED"
        : "AVAILABLE",

      activeTenant: activeTenant || null,
    });
  } catch (error) {
    console.error("GET PROPERTY ERROR:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch property",
    });
  }
});

/* =========================================================
   CREATE PROPERTY
========================================================= */
router.post("/", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return res
        .status(403)
        .json({ error: "Organization is required" });
    }

    const {
      code,
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

    if (!code || !addressLine1) {
      return res.status(400).json({
        error: "Property code and address are required",
      });
    }

    const existingCode = await prisma.property.findFirst({
      where: {
        code,
        organizationId,
      },
    });

    if (existingCode) {
      return res.status(409).json({
        error: "Property code already exists",
      });
    }

    const property = await prisma.property.create({
      data: {
        organizationId,

        code: String(code).trim(),

        name: name ? String(name).trim() : null,

        addressLine1: String(addressLine1).trim(),

        addressLine2: addressLine2
          ? String(addressLine2).trim()
          : null,

        city: city ? String(city).trim() : null,

        state: state ? String(state).trim() : null,

        postalCode: postalCode
          ? String(postalCode).trim()
          : null,

        country: country
          ? String(country).trim()
          : null,

        propertyType: propertyType || "APARTMENT",

        purchasePrice: purchasePrice
          ? Number(purchasePrice)
          : null,

        currentValue: currentValue
          ? Number(currentValue)
          : null,

        monthlyRent: monthlyRent
          ? Number(monthlyRent)
          : null,

        description: description
          ? String(description).trim()
          : null,

        bedrooms: bedrooms ? Number(bedrooms) : null,

        bathrooms: bathrooms ? Number(bathrooms) : null,

        areaSqm: areaSqm ? Number(areaSqm) : null,

        floor: floor ? Number(floor) : null,

        furnishingStatus: furnishingStatus
          ? String(furnishingStatus).trim()
          : null,

        parkingSpaces: parkingSpaces
          ? Number(parkingSpaces)
          : 0,

        availableFrom: availableFrom
          ? new Date(availableFrom)
          : null,

        ownerName: ownerName
          ? String(ownerName).trim()
          : null,

        occupancyStatus: "AVAILABLE",

        notes: notes ? String(notes).trim() : null,

        isActive:
          typeof isActive === "boolean"
            ? isActive
            : true,
      },
    });

    console.log("PROPERTY CREATED:", {
      id: property.id,
      code: property.code,
      organizationId: property.organizationId,
    });

    return res.status(201).json(property);
  } catch (error) {
    console.error("CREATE PROPERTY ERROR:", error);

    return res.status(500).json({
      error: error.message || "Failed to create property",
    });
  }
});

/* =========================================================
   UPDATE PROPERTY
========================================================= */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res
        .status(403)
        .json({ error: "Organization is required" });
    }

    const existingProperty = await prisma.property.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!existingProperty) {
      return res.status(404).json({
        error: "Property not found",
      });
    }

    const {
      code,
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
      where: {
        id,
      },

      data: {
        code: code
          ? String(code).trim()
          : existingProperty.code,

        name: name ? String(name).trim() : null,

        addressLine1: addressLine1
          ? String(addressLine1).trim()
          : existingProperty.addressLine1,

        addressLine2: addressLine2
          ? String(addressLine2).trim()
          : null,

        city: city ? String(city).trim() : null,

        state: state ? String(state).trim() : null,

        postalCode: postalCode
          ? String(postalCode).trim()
          : null,

        country: country
          ? String(country).trim()
          : null,

        propertyType: propertyType || "APARTMENT",

        purchasePrice: purchasePrice
          ? Number(purchasePrice)
          : null,

        currentValue: currentValue
          ? Number(currentValue)
          : null,

        monthlyRent: monthlyRent
          ? Number(monthlyRent)
          : null,

        description: description
          ? String(description).trim()
          : null,

        bedrooms: bedrooms ? Number(bedrooms) : null,

        bathrooms: bathrooms ? Number(bathrooms) : null,

        areaSqm: areaSqm ? Number(areaSqm) : null,

        floor: floor ? Number(floor) : null,

        furnishingStatus: furnishingStatus
          ? String(furnishingStatus).trim()
          : null,

        parkingSpaces: parkingSpaces
          ? Number(parkingSpaces)
          : 0,

        availableFrom: availableFrom
          ? new Date(availableFrom)
          : null,

        ownerName: ownerName
          ? String(ownerName).trim()
          : null,

        notes: notes ? String(notes).trim() : null,

        isActive:
          typeof isActive === "boolean"
            ? isActive
            : true,
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

/* =========================================================
   DELETE PROPERTY
========================================================= */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res
        .status(403)
        .json({ error: "Organization is required" });
    }

    const existingProperty = await prisma.property.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!existingProperty) {
      return res.status(404).json({
        error: "Property not found",
      });
    }

    await prisma.property.delete({
      where: {
        id,
      },
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