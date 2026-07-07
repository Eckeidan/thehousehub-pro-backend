const express = require("express");
const prisma = require("../lib/prisma");

const { createNotification } = require("../utils/createNotification");
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

/* GET all leases */
router.get("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const leases = await prisma.lease.findMany({
      where: { organizationId },
      include: {
        tenant: true,
        unit: true,
        property: true,
        payments: {
          orderBy: {
            paymentDate: "desc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(leases);
  } catch (error) {
    console.error("Error fetching leases:", error);
    res.status(500).json({ error: "Failed to fetch leases" });
  }
});

/* GET single lease */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const lease = await prisma.lease.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        tenant: true,
        unit: true,
        property: true,
        payments: {
          orderBy: {
            paymentDate: "desc",
          },
        },
      },
    });

    if (!lease) {
      return res.status(404).json({ error: "Lease not found" });
    }

    res.json(lease);
  } catch (error) {
    console.error("Error fetching lease:", error);
    res.status(500).json({ error: "Failed to fetch lease" });
  }
});

/* CREATE lease */
router.post("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const {
      tenantId,
      unitId,
      propertyId,
      rentAmount,
      depositAmount,
      startDate,
      endDate,
      billingDay,
      status,
      notes,
    } = req.body;

    if (!tenantId || !propertyId || !rentAmount || !startDate) {
      return res.status(400).json({
        error: "tenantId, propertyId, rentAmount, and startDate are required",
      });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, organizationId },
    });

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    let unit = null;

    if (unitId) {
      unit = await prisma.unit.findFirst({
        where: { id: unitId, organizationId },
      });

      if (!unit) {
        return res.status(404).json({ error: "Unit not found" });
      }
    }

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    if (unitId) {
      const existingActiveLease = await prisma.lease.findFirst({
        where: {
          unitId,
          organizationId,
          status: "ACTIVE",
        },
      });

      if (existingActiveLease) {
        return res.status(400).json({
          error: "This unit already has an active lease",
        });
      }
    }

    const lease = await prisma.lease.create({
      data: {
        tenantId,
        unitId: unitId || null,
        propertyId,
        organizationId,
        rentAmount: Number(rentAmount),
        depositAmount: depositAmount ? Number(depositAmount) : 0,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        billingDay: billingDay ? Number(billingDay) : 1,
        status: status || "ACTIVE",
        notes: notes || null,
      },
      include: {
        tenant: true,
        unit: true,
        property: true,
        payments: true,
      },
    });

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        propertyId,
        unitId: unitId || null,
        monthlyRent: Number(rentAmount),
        depositAmount: depositAmount ? Number(depositAmount) : 0,
        leaseStartDate: new Date(startDate),
        leaseEndDate: endDate ? new Date(endDate) : null,
        leaseStatus: status || "ACTIVE",
        status: status === "TERMINATED" ? "INACTIVE" : "ACTIVE",
        isActive: status !== "TERMINATED",
      },
    });

    await prisma.property.update({
      where: { id: propertyId },
      data: {
        occupancyStatus: status === "TERMINATED" ? "AVAILABLE" : "OCCUPIED",
      },
    });

    if (lease.tenantId) {
      await createNotification({
        tenantId: lease.tenantId,
        title: "Lease activated",
        message: "Your lease has been activated successfully.",
        type: "SUCCESS",
        category: "LEASE",
      });
    }

    res.status(201).json(lease);
  } catch (error) {
    console.error("Error creating lease:", error);
    res.status(500).json({ error: "Failed to create lease" });
  }


});

/* UPDATE lease */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const {
      tenantId,
      unitId,
      propertyId,
      rentAmount,
      depositAmount,
      startDate,
      endDate,
      billingDay,
      status,
      notes,
    } = req.body;

    const existingLease = await prisma.lease.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!existingLease) {
      return res.status(404).json({ error: "Lease not found" });
    }

    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId, organizationId },
        select: { id: true },
      });

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
    }

    if (unitId) {
      const unit = await prisma.unit.findFirst({
        where: { id: unitId, organizationId },
        select: { id: true },
      });

      if (!unit) {
        return res.status(404).json({ error: "Unit not found" });
      }
    }

    if (propertyId) {
      const property = await prisma.property.findFirst({
        where: { id: propertyId, organizationId },
        select: { id: true },
      });

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
    }

    if (unitId && status === "ACTIVE") {
      const anotherActiveLease = await prisma.lease.findFirst({
        where: {
          unitId,
          organizationId,
          status: "ACTIVE",
          NOT: {
            id: req.params.id,
          },
        },
      });

      if (anotherActiveLease) {
        return res.status(400).json({
          error: "This unit already has another active lease",
        });
      }
    }

    const updatedLease = await prisma.lease.update({
      where: { id: req.params.id },
      data: {
        tenantId: tenantId ?? existingLease.tenantId,
        unitId: unitId ?? existingLease.unitId,
        propertyId: propertyId ?? existingLease.propertyId,
        rentAmount:
          rentAmount !== undefined ? Number(rentAmount) : existingLease.rentAmount,
        depositAmount:
          depositAmount !== undefined ? Number(depositAmount) : existingLease.depositAmount,
        startDate: startDate ? new Date(startDate) : existingLease.startDate,
        endDate: endDate ? new Date(endDate) : null,
        billingDay:
          billingDay !== undefined ? Number(billingDay) : existingLease.billingDay,
        status: status ?? existingLease.status,
        notes: notes !== undefined ? notes : existingLease.notes,
      },
      include: {
        tenant: true,
        unit: true,
        property: true,
        payments: {
          orderBy: {
            paymentDate: "desc",
          },
        },
      },
    });

    await prisma.tenant.update({
      where: { id: updatedLease.tenantId },
      data: {
        propertyId: updatedLease.propertyId,
        unitId: updatedLease.unitId || null,
        monthlyRent: updatedLease.rentAmount,
        depositAmount: updatedLease.depositAmount || 0,
        leaseStartDate: updatedLease.startDate,
        leaseEndDate: updatedLease.endDate || null,
        leaseStatus: updatedLease.status,
        status: updatedLease.status === "TERMINATED" ? "INACTIVE" : "ACTIVE",
        isActive: updatedLease.status !== "TERMINATED",
      },
    });

    res.json(updatedLease);
  } catch (error) {
    console.error("Error updating lease:", error);
    res.status(500).json({ error: "Failed to update lease" });
  }
});

/* DELETE lease */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existingLease = await prisma.lease.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!existingLease) {
      return res.status(404).json({ error: "Lease not found" });
    }

    await prisma.lease.delete({
      where: { id: req.params.id },
    });

    res.json({ message: "Lease deleted successfully" });
  } catch (error) {
    console.error("Error deleting lease:", error);
    res.status(500).json({ error: "Failed to delete lease" });
  }
});

module.exports = router;
