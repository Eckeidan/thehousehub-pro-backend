const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const prisma = require("../lib/prisma");
const cloudinary = require("../utils/cloudinary");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

const router = express.Router();

const aiRecommendationModel =
  prisma.aIRecommendation || prisma.aiRecommendation;

/* CLOUDINARY */
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "propertyos/maintenance",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter(req, file, cb) {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
    }
    cb(null, true);
  },
});

function uploadPhotos(req, res, next) {
  upload.array("photos", 5)(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "One or more photos are too large. Max 5MB each.",
        });
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          error: "You can upload a maximum of 5 photos per request.",
        });
      }
    }

    return res.status(400).json({
      error: error.message || "Photo upload failed.",
    });
  });
}

/* UTILS */
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

/* GET tenant maintenance */
router.get("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: "Tenant not linked to user" });
    }

    const tenant = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        organizationId,
      },
    });

    if (!tenant) {
      return res.status(403).json({ error: "Unauthorized tenant" });
    }

    const requests = await prisma.maintenanceRequest.findMany({
      where: {
        tenantId,
        organizationId,
      },
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
        aiRecommendations: {
          where: { type: "CONTRACTOR_SUGGESTION" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
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

/* POST tenant maintenance */
router.post(
  "/",
  requireAuth,
  requireRole("TENANT"),
  uploadPhotos,
  async (req, res) => {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(400).json({ error: "Tenant not linked to user" });
      }

      const tenant = await prisma.tenant.findFirst({
        where: {
          id: tenantId,
          organizationId,
        },
        include: {
          property: true,
          unit: true,
        },
      });

      if (!tenant) {
        return res.status(403).json({ error: "Unauthorized tenant" });
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
            url: file.path,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            provider: "cloudinary",
            publicId: file.filename,
          }))
        : [];

      const requestNumber = await generateUniqueRequestNumber();

      const createdRequest = await prisma.maintenanceRequest.create({
        data: {
          organizationId,
          requestNumber,
          propertyId: tenant.propertyId,
          unitId: tenant.unitId || null,
          tenantId: tenant.id,
          title: String(title).trim(),
          description: description ? String(description).trim() : null,
          category: safeCategory,
          priority: safePriority,
          status: "OPEN",
          preferredDate: parseOptionalDate(preferredDate),
          entryPermission: entryPermission === "true" || entryPermission === true,
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
          message: `Your maintenance request "${createdRequest.title}" has been submitted successfully.`,
          type: "INFO",
          category: "MAINTENANCE",
        });
      } catch (notificationError) {
        console.error("Tenant maintenance notification error:", notificationError);
      }

      const request = await prisma.maintenanceRequest.findFirst({
        where: {
          id: createdRequest.id,
          organizationId,
        },
        include: {
          property: true,
          unit: true,
          tenant: true,
          contractor: true,
          aiRecommendations: {
            where: { type: "CONTRACTOR_SUGGESTION" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      return res.status(201).json(request || createdRequest);
    } catch (error) {
      console.error("POST /api/tenant/maintenance error:", error);

      return res.status(500).json({
        error:
          error?.message ||
          "Failed to create maintenance request. Please try again.",
      });
    }
  }
);

module.exports = router;