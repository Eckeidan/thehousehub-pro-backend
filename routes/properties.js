const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function getOrganizationId(req) {
  return req.user?.organizationId || null;
}

router.use(requireAuth);
router.use(requireRole("ADMIN", "OWNER"));

/* GET all properties */
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
            isActive: true,
            status: true,
            leaseStatus: true,
          },
        },
        propertyImages: true,
      },
      orderBy: { createdAt: "desc" },
    });

    console.log(
      "PROPERTIES RETURNED:",
      properties.map((p) => ({
        code: p.code,
        organizationId: p.organizationId,
      }))
    );

    const formattedProperties = properties.map((property) => {
      const activeTenant = property.tenants.find((tenant) => tenant.isActive);

      return {
        id: property.id,
        code: property.code,
        organizationId: property.organizationId,

        name: property.name,
        addressLine1: property.addressLine1,
        addressLine2: property.addressLine2,
        city: property.city,
        state: property.state,
        postalCode: property.postalCode,
        country: property.country,
        propertyType: property.propertyType,
        unitsCount: property.unitsCount,
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

        tenants: property.tenants,
        propertyImages: property.propertyImages,
        isOccupied: !!activeTenant,
        activeTenant: activeTenant || null,
      };
    });

    return res.json(formattedProperties);
  } catch (error) {
    console.error("Error fetching properties:", error);
    return res.status(500).json({ error: "Failed to fetch properties" });
  }
});

/* GET one property by id */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    console.log("PROPERTY DETAIL ORG:", organizationId);
    console.log("USER:", req.user);

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const property = await prisma.property.findFirst({
      where: {
        id,
        organizationId,
      },
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
        rentPayments: {
          where: { organizationId },
        },
        expenses: {
          where: { organizationId },
        },
        incomes: {
          where: { organizationId },
        },
        communications: {
          where: { organizationId },
        },
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
      organizationId: property.organizationId,
      isOccupied: !!activeTenant,
      occupancyStatus: activeTenant ? "OCCUPIED" : "AVAILABLE",
      activeTenant: activeTenant || null,
    });
  } catch (error) {
    console.error("Error fetching property:", error);
    return res.status(500).json({ error: "Failed to fetch property" });
  }
});

/* CREATE property */
router.post("/", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
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
      unitsCount,
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
      occupancyStatus,
      notes,
      isActive,
    } = req.body;

    if (!code || !addressLine1) {
      return res.status(400).json({
        error: "Code and address are required",
      });
    }

    console.log("CREATE PROPERTY REQ USER:", req.user);
    console.log("CREATE PROPERTY ORG:", organizationId);
    console.log("CREATE PROPERTY BODY:", req.body);

    const property = await prisma.property.create({
      data: {
        organizationId,

        code,
        name: name || null,
        addressLine1,
        addressLine2: addressLine2 || null,
        city: city || null,
        state: state || null,
        postalCode: postalCode || null,
        country: country || null,
        propertyType: propertyType || "APARTMENT",
        unitsCount: unitsCount ? Number(unitsCount) : 1,
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
        currentValue: currentValue ? Number(currentValue) : null,
        monthlyRent: monthlyRent ? Number(monthlyRent) : null,
        description: description || null,
        bedrooms: bedrooms ? Number(bedrooms) : null,
        bathrooms: bathrooms ? Number(bathrooms) : null,
        areaSqm: areaSqm ? Number(areaSqm) : null,
        floor: floor ? Number(floor) : null,
        furnishingStatus: furnishingStatus || null,
        parkingSpaces: parkingSpaces ? Number(parkingSpaces) : 0,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        ownerName: ownerName || null,
        occupancyStatus: occupancyStatus || "AVAILABLE",
        notes: notes || null,
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    console.log("PROPERTY CREATED RESULT:", property);

    console.log("PROPERTY CREATED:", {
      code: property.code,
      organizationId: property.organizationId,
    });

    return res.status(201).json(property);
  } catch (error) {
    console.error("Error creating property:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to create property" });
  }
});

/* UPDATE property */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const existing = await prisma.property.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Property not found" });
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
      unitsCount,
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
      occupancyStatus,
      notes,
      isActive,
    } = req.body;

    const property = await prisma.property.update({
      where: { id },
      data: {
        code,
        name: name || null,
        addressLine1,
        addressLine2: addressLine2 || null,
        city: city || null,
        state: state || null,
        postalCode: postalCode || null,
        country: country || null,
        propertyType: propertyType || "APARTMENT",
        unitsCount: unitsCount ? Number(unitsCount) : 1,
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
        currentValue: currentValue ? Number(currentValue) : null,
        monthlyRent: monthlyRent ? Number(monthlyRent) : null,
        description: description || null,
        bedrooms: bedrooms ? Number(bedrooms) : null,
        bathrooms: bathrooms ? Number(bathrooms) : null,
        areaSqm: areaSqm ? Number(areaSqm) : null,
        floor: floor ? Number(floor) : null,
        furnishingStatus: furnishingStatus || null,
        parkingSpaces: parkingSpaces ? Number(parkingSpaces) : 0,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        ownerName: ownerName || null,
        occupancyStatus: occupancyStatus || "AVAILABLE",
        notes: notes || null,
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    return res.json(property);
  } catch (error) {
    console.error("Error updating property:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to update property" });
  }
});

/* DELETE property */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const { id } = req.params;

    if (!organizationId) {
      return res.status(403).json({ error: "Organization is required" });
    }

    const existing = await prisma.property.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Property not found" });
    }

    await prisma.property.delete({
      where: { id },
    });

    return res.json({ message: "Property deleted successfully" });
  } catch (error) {
    console.error("Error deleting property:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to delete property" });
  }
});

module.exports = router;