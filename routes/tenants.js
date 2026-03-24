const express = require("express");
const prisma = require("../lib/prisma");
const bcrypt = require("bcryptjs");

const router = express.Router();

/* GET all tenants */
router.get("/", async (req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        property: true,
        unit: true,
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(tenants);
  } catch (error) {
    console.error("Error fetching tenants:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch tenants",
    });
  }
});

/* GET one tenant by id */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    res.json(tenant);
  } catch (error) {
    console.error("Error fetching tenant:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch tenant",
    });
  }
});

/* CREATE tenant */
router.post("/", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      propertyId,
      unitId,
      leaseStart,
      leaseEnd,
      status,
      emergencyContactName,
      emergencyContactPhone,
      notes,
    } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({
        error: "firstName and lastName are required",
      });
    }

    let unit = null;
    let property = null;

    if (unitId) {
      unit = await prisma.unit.findUnique({
        where: { id: unitId },
      });

      if (!unit) {
        return res.status(404).json({ error: "Unit not found" });
      }

      const existingActiveLease = await prisma.lease.findFirst({
        where: {
          unitId,
          status: "ACTIVE",
        },
      });

      if (existingActiveLease) {
        return res.status(400).json({
          error: "This unit already has an active lease",
        });
      }
    }

    if (propertyId) {
      property = await prisma.property.findUnique({
        where: { id: propertyId },
      });

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
    }

    const finalPropertyId = propertyId || unit?.propertyId || null;

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          emergencyContactName: emergencyContactName || null,
          emergencyContactPhone: emergencyContactPhone || null,
          leaseStartDate: leaseStart ? new Date(leaseStart) : null,
          leaseEndDate: leaseEnd ? new Date(leaseEnd) : null,
          leaseStatus: "ACTIVE",
          status: status || "ACTIVE",
          isActive: status === "INACTIVE" ? false : true,
          notes: notes || null,

          ...(finalPropertyId
            ? {
                property: {
                  connect: { id: finalPropertyId },
                },
              }
            : {}),

          ...(unitId
            ? {
                unit: {
                  connect: { id: unitId },
                },
              }
            : {}),
        },
      });

      let lease = null;

      if (unitId && finalPropertyId) {
        const startDate = leaseStart ? new Date(leaseStart) : new Date();
        const billingDay = startDate.getDate();
        const rentAmount = Number(unit?.monthlyRent || 0);

        lease = await tx.lease.create({
          data: {
            tenantId: tenant.id,
            unitId,
            propertyId: finalPropertyId,
            rentAmount,
            depositAmount: 0,
            startDate,
            endDate: leaseEnd ? new Date(leaseEnd) : null,
            billingDay,
            status: "ACTIVE",
            notes: "Auto-created from tenant assignment",
          },
        });

        await tx.unit.update({
          where: { id: unitId },
          data: {
            occupancyStatus: "OCCUPIED",
          },
        });
      }

      const fullTenant = await tx.tenant.findUnique({
        where: { id: tenant.id },
        include: {
          property: true,
          unit: true,
          maintenanceRequests: true,
          leases: true,
          user: true,
        },
      });

      return {
        tenant: fullTenant,
        lease,
      };
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("Error creating tenant:", error);
    res.status(500).json({ error: error.message || "Failed to create tenant" });
  }
});

/* CREATE tenant login account */
router.post("/:id/create-account", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, fullName } = req.body || {};

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        error: "Email is required",
      });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters",
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    if (tenant.user) {
      return res.status(400).json({
        error: "This tenant already has an account",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email: String(email).trim().toLowerCase(),
      },
    });

    if (existingUser) {
      return res.status(400).json({
        error: "This email is already used by another account",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const createdUser = await prisma.user.create({
      data: {
        fullName:
          fullName?.trim() ||
          `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim(),
        email: String(email).trim().toLowerCase(),
        passwordHash,
        role: "TENANT",
        isActive: true,
        tenant: {
          connect: { id: tenant.id },
        },
      },
    });

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        email: String(email).trim().toLowerCase(),
      },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    res.status(201).json({
      message: "Tenant account created successfully",
      user: {
        id: createdUser.id,
        fullName: createdUser.fullName,
        email: createdUser.email,
        role: createdUser.role,
      },
      tenant: updatedTenant,
    });
  } catch (error) {
    console.error("Error creating tenant account:", error);
    res.status(500).json({
      error: error.message || "Failed to create tenant account",
    });
  }
});

/* MOVE OUT tenant */
router.patch("/:id/move-out", async (req, res) => {
  try {
    const { id } = req.params;

    const existingTenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        property: true,
        unit: true,
      },
    });

    if (!existingTenant) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    const updatedTenant = await prisma.tenant.update({
      where: { id },
      data: {
        status: "INACTIVE",
        isActive: false,
        leaseStatus: "TERMINATED",
      },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (existingTenant.unit?.id) {
      await prisma.unit.update({
        where: { id: existingTenant.unit.id },
        data: {
          occupancyStatus: "AVAILABLE",
        },
      });
    }

    await prisma.lease.updateMany({
      where: {
        tenantId: id,
        status: "ACTIVE",
      },
      data: {
        status: "TERMINATED",
      },
    });

    res.json({
      message: "Tenant moved out successfully",
      tenant: updatedTenant,
    });
  } catch (error) {
    console.error("Move out error:", error);
    res.status(500).json({
      error: error.message || "Failed to move out tenant",
    });
  }
});

/* DELETE tenant */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    await prisma.$transaction(async (tx) => {
      if (tenant.user?.id) {
        await tx.user.delete({
          where: { id: tenant.user.id },
        });
      }

      await tx.tenant.delete({
        where: { id },
      });
    });

    const remainingActiveTenant = tenant.unit?.id
      ? await prisma.tenant.findFirst({
          where: {
            isActive: true,
            unitId: tenant.unit.id,
          },
        })
      : null;

    if (tenant.unit?.id && !remainingActiveTenant) {
      await prisma.unit.update({
        where: { id: tenant.unit.id },
        data: {
          occupancyStatus: "AVAILABLE",
        },
      });
    }

    res.json({ message: "Tenant deleted successfully" });
  } catch (error) {
    console.error("Error deleting tenant:", error);
    res.status(500).json({
      error: error.message || "Failed to delete tenant",
    });
  }
});

/* UPDATE tenant */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      propertyId,
      unitId,
      firstName,
      lastName,
      email,
      phone,
      leaseStartDate,
      leaseEndDate,
      emergencyContactName,
      emergencyContactPhone,
      status,
      notes,
    } = req.body || {};

    const existingTenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (!existingTenant) {
      return res.status(404).json({
        error: "Tenant not found",
      });
    }

    if (!firstName || !lastName) {
      return res.status(400).json({
        error: "First name and last name are required",
      });
    }

    if (!propertyId) {
      return res.status(400).json({
        error: "Property is required",
      });
    }

    if (!unitId) {
      return res.status(400).json({
        error: "Unit is required",
      });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      return res.status(404).json({
        error: "Selected property not found",
      });
    }

    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: {
        property: true,
      },
    });

    if (!unit) {
      return res.status(404).json({
        error: "Selected unit not found",
      });
    }

    if (unit.propertyId !== propertyId) {
      return res.status(400).json({
        error: "Selected unit does not belong to the selected property",
      });
    }

    const conflictingTenant = await prisma.tenant.findFirst({
      where: {
        id: { not: id },
        isActive: true,
        unitId,
      },
      include: {
        unit: true,
      },
    });

    if (conflictingTenant && status !== "INACTIVE") {
      return res.status(400).json({
        error: "This unit already has another active tenant.",
      });
    }

    const updatedTenant = await prisma.tenant.update({
      where: { id },
      data: {
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        leaseStartDate: leaseStartDate ? new Date(leaseStartDate) : null,
        leaseEndDate: leaseEndDate ? new Date(leaseEndDate) : null,
        emergencyContactName: emergencyContactName || null,
        emergencyContactPhone: emergencyContactPhone || null,
        status: status || "ACTIVE",
        isActive: status === "INACTIVE" ? false : true,
        leaseStatus: status === "INACTIVE" ? "TERMINATED" : "ACTIVE",
        notes: notes || null,
        property: {
          connect: { id: propertyId },
        },
        unit: {
          connect: { id: unitId },
        },
      },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (existingTenant.user?.id && email && email !== existingTenant.user.email) {
      await prisma.user.update({
        where: { id: existingTenant.user.id },
        data: {
          email,
          fullName: `${firstName} ${lastName}`.trim(),
        },
      });
    } else if (existingTenant.user?.id) {
      await prisma.user.update({
        where: { id: existingTenant.user.id },
        data: {
          fullName: `${firstName} ${lastName}`.trim(),
        },
      });
    }

    if (existingTenant.unit?.id && existingTenant.unit.id !== unitId) {
      const oldUnitActiveTenant = await prisma.tenant.findFirst({
        where: {
          isActive: true,
          unitId: existingTenant.unit.id,
        },
      });

      if (!oldUnitActiveTenant) {
        await prisma.unit.update({
          where: { id: existingTenant.unit.id },
          data: { occupancyStatus: "AVAILABLE" },
        });
      }
    }

    await prisma.unit.update({
      where: { id: unitId },
      data: {
        occupancyStatus: status === "INACTIVE" ? "AVAILABLE" : "OCCUPIED",
      },
    });

    res.json(updatedTenant);
  } catch (error) {
    console.error("Error updating tenant:", error);
    res.status(500).json({
      error: error.message || "Failed to update tenant",
    });
  }
});

module.exports = router;