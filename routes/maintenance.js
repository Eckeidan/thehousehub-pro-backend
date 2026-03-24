const express = require("express");
const prisma = require("../lib/prisma");
const { createNotification } = require("../utils/createNotification");

const router = express.Router();

function generateRequestNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `MR-${year}-${random}`;
}

async function generateUniqueRequestNumber() {
  let requestNumber;
  let exists = true;

  while (exists) {
    requestNumber = generateRequestNumber();

    const found = await prisma.maintenanceRequest.findUnique({
      where: { requestNumber },
    });

    exists = !!found;
  }

  return requestNumber;
}

function parseOptionalDate(value) {
  if (!value || value === "") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isValidCategory(value) {
  return [
    "PLUMBING",
    "ELECTRICAL",
    "HVAC",
    "LOCKS",
    "PAINTING",
    "PEST_CONTROL",
    "APPLIANCE",
    "GENERAL",
    "OTHER",
  ].includes(value);
}

function isValidPriority(value) {
  return ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(value);
}

/* =========================
   GET /api/maintenance
   ========================= */
router.get("/", async (req, res) => {
  try {
    const { status, priority, category, search, propertyId, unitId, tenantId } =
      req.query;

    const where = {
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(category ? { category } : {}),
      ...(propertyId ? { propertyId } : {}),
      ...(unitId ? { unitId } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { requestNumber: { contains: search, mode: "insensitive" } },
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
              {
                unit: {
                  OR: [
                    { unitCode: { contains: search, mode: "insensitive" } },
                    { unitName: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
              {
                tenant: {
                  OR: [
                    { firstName: { contains: search, mode: "insensitive" } },
                    { lastName: { contains: search, mode: "insensitive" } },
                    { email: { contains: search, mode: "insensitive" } },
                    { phone: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const requests = await prisma.maintenanceRequest.findMany({
      where,
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(requests);
  } catch (error) {
    console.error("Error fetching maintenance requests:", error);
    res.status(500).json({ error: "Failed to fetch maintenance requests" });
  }
});

/* =========================
   GET /api/maintenance/stats
   ========================= */
router.get("/stats", async (req, res) => {
  try {
    const [total, open, inProgress, resolved, urgent, closed] =
      await Promise.all([
        prisma.maintenanceRequest.count(),
        prisma.maintenanceRequest.count({ where: { status: "OPEN" } }),
        prisma.maintenanceRequest.count({ where: { status: "IN_PROGRESS" } }),
        prisma.maintenanceRequest.count({ where: { status: "RESOLVED" } }),
        prisma.maintenanceRequest.count({ where: { priority: "URGENT" } }),
        prisma.maintenanceRequest.count({ where: { status: "CLOSED" } }),
      ]);

    res.json({
      total,
      open,
      inProgress,
      resolved,
      urgent,
      closed,
    });
  } catch (error) {
    console.error("Error fetching maintenance stats:", error);
    res.status(500).json({ error: "Failed to fetch maintenance stats" });
  }
});

/* =========================
   GET /api/maintenance/:id
   ========================= */
router.get("/:id", async (req, res) => {
  try {
    const request = await prisma.maintenanceRequest.findUnique({
      where: { id: req.params.id },
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
      },
    });

    if (!request) {
      return res.status(404).json({ error: "Maintenance request not found" });
    }

    res.json(request);
  } catch (error) {
    console.error("Error fetching maintenance request:", error);
    res.status(500).json({ error: "Failed to fetch maintenance request" });
  }
});

/* =========================
   POST /api/maintenance
   ========================= */
router.post("/", async (req, res) => {
  try {
    const {
      propertyId,
      unitId,
      tenantId,
      title,
      description,
      category,
      priority,
      preferredDate,
      entryPermission,
    } = req.body;

    console.log("Incoming maintenance payload:", req.body);

    if (!propertyId || String(propertyId).trim() === "") {
      return res.status(400).json({
        error: "Property is required",
      });
    }

    if (!title || String(title).trim() === "") {
      return res.status(400).json({
        error: "Title is required",
      });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    let unit = null;

    if (unitId) {
      unit = await prisma.unit.findUnique({
        where: { id: unitId },
      });

      if (!unit) {
        return res.status(404).json({ error: "Unit not found" });
      }

      if (unit.propertyId !== propertyId) {
        return res.status(400).json({
          error: "Selected unit does not belong to the selected property",
        });
      }
    }

    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      if (tenant.propertyId && tenant.propertyId !== propertyId) {
        return res.status(400).json({
          error: "Selected tenant does not belong to the selected property",
        });
      }

      if (unitId && tenant.unitId && tenant.unitId !== unitId) {
        return res.status(400).json({
          error: "Selected tenant does not belong to the selected unit",
        });
      }
    }

    const safeCategory =
      category && isValidCategory(category) ? category : "GENERAL";
    const safePriority =
      priority && isValidPriority(priority) ? priority : "MEDIUM";
    const safePreferredDate = parseOptionalDate(preferredDate);
    const requestNumber = await generateUniqueRequestNumber();

    const createData = {
      requestNumber,
      propertyId,
      unitId: unitId || null,
      tenantId: tenantId || null,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      category: safeCategory,
      priority: safePriority,
      preferredDate: safePreferredDate,
      entryPermission: Boolean(entryPermission),
    };

    console.log("Maintenance create data:", createData);

    const request = await prisma.maintenanceRequest.create({
      data: createData,
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
      },
    });

    if (request.tenantId) {
      await createNotification({
        tenantId: request.tenantId,
        title: "Maintenance request created",
        message: `Your maintenance request "${request.title}" has been submitted successfully.`,
        type: "INFO",
        category: "MAINTENANCE",
      });
    }

    return res.status(201).json(request);
  } catch (error) {
    console.error("POST /api/maintenance error FULL:", error);

    return res.status(500).json({
      error:
        error?.message ||
        error?.code ||
        "Failed to create maintenance request",
    });
  }
});

/* =========================
   PUT /api/maintenance/:id
   ========================= */
router.put("/:id", async (req, res) => {
  try {
    const {
      propertyId,
      unitId,
      tenantId,
      contractorId,
      title,
      description,
      category,
      priority,
      status,
      locationNote,
      assignedTo,
      preferredDate,
      entryPermission,
      estimatedCost,
      actualCost,
      adminNotes,
      photos,
      dueDate,
      resolvedAt,
      completedAt,
      notes,
    } = req.body || {};

    const existing = await prisma.maintenanceRequest.findUnique({
      where: { id: req.params.id },
      include: {
        property: true,
        unit: true,
        tenant: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Maintenance request not found" });
    }

    if (propertyId) {
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
      });

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
    }

    if (unitId) {
      const unit = await prisma.unit.findUnique({
        where: { id: unitId },
      });

      if (!unit) {
        return res.status(404).json({ error: "Unit not found" });
      }

      const effectivePropertyId = propertyId || existing.propertyId;

      if (unit.propertyId !== effectivePropertyId) {
        return res.status(400).json({
          error: "Selected unit does not belong to the selected property",
        });
      }
    }

    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const effectivePropertyId = propertyId || existing.propertyId;
      const effectiveUnitId =
        unitId !== undefined ? unitId : existing.unitId || null;

      if (tenant.propertyId && tenant.propertyId !== effectivePropertyId) {
        return res.status(400).json({
          error: "Selected tenant does not belong to the selected property",
        });
      }

      if (effectiveUnitId && tenant.unitId && tenant.unitId !== effectiveUnitId) {
        return res.status(400).json({
          error: "Selected tenant does not belong to the selected unit",
        });
      }
    }

    if (contractorId) {
      const contractor = await prisma.contractor.findUnique({
        where: { id: contractorId },
      });

      if (!contractor) {
        return res.status(404).json({ error: "Contractor not found" });
      }
    }

    const request = await prisma.maintenanceRequest.update({
      where: { id: req.params.id },
      data: {
        ...(propertyId !== undefined ? { propertyId } : {}),
        ...(unitId !== undefined ? { unitId: unitId || null } : {}),
        ...(tenantId !== undefined ? { tenantId: tenantId || null } : {}),
        ...(contractorId !== undefined
          ? { contractorId: contractorId || null }
          : {}),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(locationNote !== undefined ? { locationNote } : {}),
        ...(assignedTo !== undefined ? { assignedTo } : {}),
        ...(preferredDate !== undefined
          ? { preferredDate: parseOptionalDate(preferredDate) }
          : {}),
        ...(entryPermission !== undefined
          ? { entryPermission: Boolean(entryPermission) }
          : {}),
        ...(estimatedCost !== undefined
          ? {
              estimatedCost:
                estimatedCost !== null && estimatedCost !== ""
                  ? estimatedCost.toString()
                  : null,
            }
          : {}),
        ...(actualCost !== undefined
          ? {
              actualCost:
                actualCost !== null && actualCost !== ""
                  ? actualCost.toString()
                  : null,
            }
          : {}),
        ...(adminNotes !== undefined ? { adminNotes } : {}),
        ...(photos !== undefined ? { photos } : {}),
        ...(dueDate !== undefined
          ? { dueDate: parseOptionalDate(dueDate) }
          : {}),
        ...(resolvedAt !== undefined
          ? { resolvedAt: parseOptionalDate(resolvedAt) }
          : {}),
        ...(completedAt !== undefined
          ? { completedAt: parseOptionalDate(completedAt) }
          : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
      },
    });

    res.json(request);
  } catch (error) {
    console.error("Error updating maintenance request:", error);
    res.status(500).json({
      error: error.message || "Failed to update maintenance request",
    });
  }
});

/* =========================
   PATCH /api/maintenance/:id/status
   ========================= */
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const allowedStatuses = [
      "OPEN",
      "IN_PROGRESS",
      "ON_HOLD",
      "RESOLVED",
      "CLOSED",
      "CANCELLED",
    ];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const existing = await prisma.maintenanceRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Maintenance request not found" });
    }

    const updateData = {
      status,
    };

    if (status === "RESOLVED") {
      updateData.resolvedAt = new Date();
    }

    if (status === "CLOSED") {
      updateData.completedAt = new Date();
      if (!existing.resolvedAt) {
        updateData.resolvedAt = new Date();
      }
    }

    if (status === "OPEN" || status === "IN_PROGRESS" || status === "ON_HOLD") {
      updateData.resolvedAt = null;
      updateData.completedAt = null;
    }

    const request = await prisma.maintenanceRequest.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
      },
    });

    if (request.tenantId) {
      await createNotification({
        tenantId: request.tenantId,
        title: "Maintenance status updated",
        message: `Your maintenance request "${request.title}" is now ${request.status}.`,
        type:
          request.status === "RESOLVED" || request.status === "CLOSED"
            ? "SUCCESS"
            : "INFO",
        category: "MAINTENANCE",
      });
    }

    res.json(request);
  } catch (error) {
    console.error("Error updating maintenance status:", error);
    res.status(500).json({ error: "Failed to update maintenance status" });
  }
});

/* =========================
   DELETE /api/maintenance/:id
   ========================= */
router.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.maintenanceRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ error: "Maintenance request not found" });
    }

    await prisma.maintenanceRequest.delete({
      where: { id: req.params.id },
    });

    res.json({ message: "Maintenance request deleted successfully" });
  } catch (error) {
    console.error("Error deleting maintenance request:", error);
    res.status(500).json({ error: "Failed to delete maintenance request" });
  }
});

module.exports = router;