const express = require("express");
const prisma = require("../lib/prisma");
const bcrypt = require("bcryptjs");
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

/* GET all tenants */
router.get("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenants = await prisma.tenant.findMany({
      where: { organizationId },
      include: {
        property: true,
        unit: true,
        user: true,
        leases: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(tenants);
  } catch (error) {
    console.error("Error fetching tenants:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch tenants",
    });
  }
});

/* GET one tenant by id */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: {
        property: true,
        unit: true,
        user: true,
        leases: {
          orderBy: { createdAt: "desc" },
        },
        maintenanceRequests: true,
        documents: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    return res.json(tenant);
  } catch (error) {
    console.error("Error fetching tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch tenant",
    });
  }
});

/* CREATE tenant */
router.post("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

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
    } = req.body || {};

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

    const property = await prisma.property.findFirst({
      where: {
        id: propertyId,
        organizationId,
      },
    });

    if (!property) {
      return res.status(404).json({
        error: "Property not found in your organization",
      });
    }

    const existingActiveTenant = await prisma.tenant.findFirst({
      where: {
        organizationId,
        propertyId,
        isActive: true,
      },
    });

    if (existingActiveTenant && status !== "INACTIVE") {
      return res.status(400).json({
        error: "This property already has an active tenant",
      });
    }

    const finalStatus = status || "ACTIVE";
    const isActive = finalStatus === "INACTIVE" ? false : true;

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          organizationId,
          propertyId,
          unitId: unitId || null,

          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          email: email ? String(email).trim().toLowerCase() : null,
          phone: phone ? String(phone).trim() : null,

          emergencyContactName: emergencyContactName
            ? String(emergencyContactName).trim()
            : null,
          emergencyContactPhone: emergencyContactPhone
            ? String(emergencyContactPhone).trim()
            : null,

          leaseStartDate: leaseStart ? new Date(leaseStart) : null,
          leaseEndDate: leaseEnd ? new Date(leaseEnd) : null,
          leaseStatus: isActive ? "ACTIVE" : "TERMINATED",
          status: finalStatus,
          isActive,
          monthlyRent: property.monthlyRent || null,
          notes: notes ? String(notes).trim() : null,
        },
      });

      await tx.property.update({
        where: { id: propertyId },
        data: {
          occupancyStatus: isActive ? "OCCUPIED" : "AVAILABLE",
        },
      });

      const fullTenant = await tx.tenant.findFirst({
        where: {
          id: tenant.id,
          organizationId,
        },
        include: {
          property: true,
          unit: true,
          user: true,
          leases: true,
          maintenanceRequests: true,
        },
      });

      return { tenant: fullTenant };
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error("Error creating tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to create tenant",
    });
  }
});

/* CREATE tenant login account */
router.post("/:id/create-account", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const { email, password, fullName } = req.body || {};

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters",
      });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: { user: true },
    });

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    if (tenant.user) {
      return res.status(400).json({
        error: "This tenant already has an account",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      return res.status(400).json({
        error: "This email is already used by another account",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const createdUser = await prisma.user.create({
      data: {
        organizationId,
        fullName:
          fullName?.trim() ||
          `${tenant.firstName || ""} ${tenant.lastName || ""}`.trim(),
        email: cleanEmail,
        passwordHash,
        role: "TENANT",
        isActive: true,
        mustChangePassword: true,
        tenantId: tenant.id,
      },
    });

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        email: cleanEmail,
      },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    return res.status(201).json({
      message: "Tenant account created successfully",
      user: {
        id: createdUser.id,
        fullName: createdUser.fullName,
        email: createdUser.email,
        role: createdUser.role,
        organizationId: createdUser.organizationId,
        mustChangePassword: createdUser.mustChangePassword,
      },
      tenant: updatedTenant,
    });
  } catch (error) {
    console.error("Error creating tenant account:", error);
    return res.status(500).json({
      error: error.message || "Failed to create tenant account",
    });
  }
});

/* MOVE OUT tenant */
router.patch("/:id/move-out", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const existingTenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: {
        property: true,
        unit: true,
      },
    });

    if (!existingTenant) {
      return res.status(404).json({ error: "Tenant not found" });
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

    if (existingTenant.propertyId) {
      const remainingActiveTenant = await prisma.tenant.findFirst({
        where: {
          organizationId,
          propertyId: existingTenant.propertyId,
          isActive: true,
          id: { not: id },
        },
      });

      if (!remainingActiveTenant) {
        await prisma.property.update({
          where: { id: existingTenant.propertyId },
          data: {
            occupancyStatus: "AVAILABLE",
          },
        });
      }
    }

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
        organizationId,
        tenantId: id,
        status: "ACTIVE",
      },
      data: {
        status: "TERMINATED",
      },
    });

    return res.json({
      message: "Tenant moved out successfully",
      tenant: updatedTenant,
    });
  } catch (error) {
    console.error("Move out error:", error);
    return res.status(500).json({
      error: error.message || "Failed to move out tenant",
    });
  }
});

/* DELETE tenant */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    const tenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
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

      if (tenant.propertyId) {
        const remainingActiveTenant = await tx.tenant.findFirst({
          where: {
            organizationId,
            propertyId: tenant.propertyId,
            isActive: true,
          },
        });

        if (!remainingActiveTenant) {
          await tx.property.update({
            where: { id: tenant.propertyId },
            data: {
              occupancyStatus: "AVAILABLE",
            },
          });
        }
      }

      if (tenant.unitId) {
        const remainingActiveTenantOnUnit = await tx.tenant.findFirst({
          where: {
            organizationId,
            unitId: tenant.unitId,
            isActive: true,
          },
        });

        if (!remainingActiveTenantOnUnit) {
          await tx.unit.update({
            where: { id: tenant.unitId },
            data: {
              occupancyStatus: "AVAILABLE",
            },
          });
        }
      }
    });

    return res.json({ message: "Tenant deleted successfully" });
  } catch (error) {
    console.error("Error deleting tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to delete tenant",
    });
  }
});

/* UPDATE tenant */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

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

    const existingTenant = await prisma.tenant.findFirst({
      where: { id, organizationId },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (!existingTenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    if (!firstName || !lastName) {
      return res.status(400).json({
        error: "First name and last name are required",
      });
    }

    if (!propertyId) {
      return res.status(400).json({ error: "Property is required" });
    }

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId },
    });

    if (!property) {
      return res.status(404).json({ error: "Selected property not found" });
    }

    const conflictingTenant = await prisma.tenant.findFirst({
      where: {
        organizationId,
        id: { not: id },
        isActive: true,
        propertyId,
      },
    });

    if (conflictingTenant && status !== "INACTIVE") {
      return res.status(400).json({
        error: "This property already has another active tenant.",
      });
    }

    const finalStatus = status || "ACTIVE";
    const isActive = finalStatus === "INACTIVE" ? false : true;

    const updatedTenant = await prisma.tenant.update({
      where: { id },
      data: {
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: email ? String(email).trim().toLowerCase() : null,
        phone: phone ? String(phone).trim() : null,

        leaseStartDate: leaseStartDate ? new Date(leaseStartDate) : null,
        leaseEndDate: leaseEndDate ? new Date(leaseEndDate) : null,

        emergencyContactName: emergencyContactName
          ? String(emergencyContactName).trim()
          : null,
        emergencyContactPhone: emergencyContactPhone
          ? String(emergencyContactPhone).trim()
          : null,

        status: finalStatus,
        isActive,
        leaseStatus: isActive ? "ACTIVE" : "TERMINATED",
        notes: notes ? String(notes).trim() : null,

        propertyId,
        unitId: unitId || null,
        monthlyRent: property.monthlyRent || null,
      },
      include: {
        property: true,
        unit: true,
        user: true,
      },
    });

    if (existingTenant.user?.id) {
      await prisma.user.update({
        where: { id: existingTenant.user.id },
        data: {
          ...(email ? { email: String(email).trim().toLowerCase() } : {}),
          fullName: `${firstName} ${lastName}`.trim(),
        },
      });
    }

    if (existingTenant.propertyId && existingTenant.propertyId !== propertyId) {
      const oldPropertyActiveTenant = await prisma.tenant.findFirst({
        where: {
          organizationId,
          isActive: true,
          propertyId: existingTenant.propertyId,
        },
      });

      if (!oldPropertyActiveTenant) {
        await prisma.property.update({
          where: { id: existingTenant.propertyId },
          data: { occupancyStatus: "AVAILABLE" },
        });
      }
    }

    await prisma.property.update({
      where: { id: propertyId },
      data: {
        occupancyStatus: isActive ? "OCCUPIED" : "AVAILABLE",
      },
    });

    return res.json(updatedTenant);
  } catch (error) {
    console.error("Error updating tenant:", error);
    return res.status(500).json({
      error: error.message || "Failed to update tenant",
    });
  }
});

module.exports = router;