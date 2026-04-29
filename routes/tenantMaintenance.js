const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads", "maintenance");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const safeName = file.originalname
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9.\-_]/g, "");

    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
  },
  fileFilter(req, file, cb) {
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
    }

    cb(null, true);
  },
});

function generateRequestNumber() {
  const year = new Date().getFullYear();
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
  return Number.isNaN(date.getTime()) ? null : date;
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

/**
 * GET /api/tenant/maintenance
 */
router.get("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: "Tenant not linked to user" });
    }

    const requests = await prisma.maintenanceRequest.findMany({
      where: { tenantId },
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(requests);
  } catch (error) {
    console.error("GET /api/tenant/maintenance error:", error);
    return res.status(500).json({
      error: "Failed to load tenant maintenance requests",
    });
  }
});

/**
 * POST /api/tenant/maintenance
 */
router.post(
  "/",
  requireAuth,
  requireRole("TENANT"),
  upload.array("photos", 5),
  async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(400).json({ error: "Tenant not linked to user" });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          property: true,
          unit: true,
        },
      });

      if (!tenant) {
        return res.status(404).json({ error: "Tenant profile not found" });
      }

      if (!tenant.propertyId) {
        return res.status(400).json({ error: "Tenant has no property linked" });
      }

      const {
        title,
        description,
        category,
        priority,
        preferredDate,
        entryPermission,
        locationNote,
      } = req.body;

      if (!title || String(title).trim() === "") {
        return res.status(400).json({ error: "Title is required" });
      }

      const safeCategory =
        category && isValidCategory(category) ? category : "GENERAL";

      const safePriority =
        priority && isValidPriority(priority) ? priority : "MEDIUM";

      const photos = Array.isArray(req.files)
        ? req.files.map((file) => ({
            url: `/uploads/maintenance/${file.filename}`,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          }))
        : [];

      const requestNumber = await generateUniqueRequestNumber();

      const request = await prisma.maintenanceRequest.create({
        data: {
          requestNumber,
          propertyId: tenant.propertyId,
          unitId: tenant.unitId || null,
          tenantId: tenant.id,
          title: String(title).trim(),
          description: description ? String(description).trim() : null,
          category: safeCategory,
          priority: safePriority,
          preferredDate: parseOptionalDate(preferredDate),
          entryPermission:
            entryPermission === "true" || entryPermission === true,
          locationNote: locationNote ? String(locationNote).trim() : null,
          photos: photos.length ? photos : null,
        },
        include: {
          property: true,
          unit: true,
          tenant: true,
          contractor: true,
        },
      });

      try {
        await createNotification({
          tenantId: tenant.id,
          title: "Maintenance request created",
          message: `Your maintenance request "${request.title}" has been submitted successfully.`,
          type: "INFO",
          category: "MAINTENANCE",
        });
      } catch (notificationError) {
        console.error("Tenant maintenance notification error:", notificationError);
      }

      return res.status(201).json(request);
    } catch (error) {
      console.error("POST /api/tenant/maintenance error:", error);
      return res.status(500).json({
        error: error?.message || "Failed to create maintenance request",
      });
    }
  }
);

module.exports = router;