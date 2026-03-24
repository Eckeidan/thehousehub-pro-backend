const express = require("express");
const prisma = require("../lib/prisma");

const { createNotification } = require("../utils/createNotification");
const router = express.Router();

/* GET all leases */
router.get("/", async (req, res) => {
  try {
    const leases = await prisma.lease.findMany({
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
    const lease = await prisma.lease.findUnique({
      where: { id: req.params.id },
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

    if (!tenantId || !unitId || !propertyId || !rentAmount || !startDate) {
      return res.status(400).json({
        error: "tenantId, unitId, propertyId, rentAmount, and startDate are required",
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
    });

    if (!unit) {
      return res.status(404).json({ error: "Unit not found" });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
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

    const lease = await prisma.lease.create({
      data: {
        tenantId,
        unitId,
        propertyId,
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

    res.status(201).json(lease);
  } catch (error) {
    console.error("Error creating lease:", error);
    res.status(500).json({ error: "Failed to create lease" });
  }


  if (lease.tenantId) {
  await createNotification({
    tenantId: lease.tenantId,
    title: "Lease activated",
    message: `Your lease has been activated successfully.`,
    type: "SUCCESS",
    category: "LEASE",
  });
}
});

/* UPDATE lease */
router.put("/:id", async (req, res) => {
  try {
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

    const existingLease = await prisma.lease.findUnique({
      where: { id: req.params.id },
    });

    if (!existingLease) {
      return res.status(404).json({ error: "Lease not found" });
    }

    if (unitId && status === "ACTIVE") {
      const anotherActiveLease = await prisma.lease.findFirst({
        where: {
          unitId,
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

    res.json(updatedLease);
  } catch (error) {
    console.error("Error updating lease:", error);
    res.status(500).json({ error: "Failed to update lease" });
  }
});

/* DELETE lease */
router.delete("/:id", async (req, res) => {
  try {
    const existingLease = await prisma.lease.findUnique({
      where: { id: req.params.id },
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