const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

/* GET all properties */
router.get("/", async (req, res) => {
  try {
    const properties = await prisma.property.findMany({
      include: {
        tenants: {
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
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedProperties = properties.map((property) => {
      const activeTenant = property.tenants.find((tenant) => tenant.isActive);

      return {
        ...property,
        isOccupied: !!activeTenant,
        occupancyStatus: activeTenant ? "OCCUPIED" : "AVAILABLE",
        activeTenant: activeTenant || null,
      };
    });

    res.json(formattedProperties);
  } catch (error) {
    console.error("Error fetching properties:", error);
    res.status(500).json({ error: "Failed to fetch properties" });
  }
});

/* GET one property by id */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const property = await prisma.property.findUnique({
      where: { id },
      include: {
        tenants: {
          orderBy: {
            createdAt: "desc",
          },
        },
        maintenanceRequests: true,
        rentPayments: true,
        expenses: true,
        incomes: true,
        documents: true,
        communications: true,
        propertyImages: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const activeTenant = property.tenants.find((tenant) => tenant.isActive);

    res.json({
      ...property,
      isOccupied: !!activeTenant,
      occupancyStatus: activeTenant ? "OCCUPIED" : "AVAILABLE",
      activeTenant: activeTenant || null,
    });
  } catch (error) {
    console.error("Error fetching property:", error);
    res.status(500).json({ error: "Failed to fetch property" });
  }
});

/* CREATE property */
router.post("/", async (req, res) => {
  try {
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

    const property = await prisma.property.create({
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

    res.status(201).json(property);
  } catch (error) {
    console.error("Error creating property:", error);
    res.status(500).json({ error: error.message || "Failed to create property" });
  }
});

/* UPDATE property */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
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

    res.json(property);
  } catch (error) {
    console.error("Error updating property:", error);
    res.status(500).json({ error: error.message || "Failed to update property" });
  }
});

/* DELETE property */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.property.delete({
      where: { id },
    });

    res.json({ message: "Property deleted successfully" });
  } catch (error) {
    console.error("Error deleting property:", error);
    res.status(500).json({ error: error.message || "Failed to delete property" });
  }
});

module.exports = router;