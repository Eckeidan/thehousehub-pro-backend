const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const streamifier = require("streamifier");

const prisma = require("../lib/prisma");
const cloudinary = require("../utils/cloudinary");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");
const { sendMaintenanceCreatedToAdmin } = require("../utils/sendEmail");

const router = express.Router();

/* CLOUDINARY UPLOAD */
const uploadDir = path.join(__dirname, "..", "uploads", "maintenance");
fs.mkdirSync(uploadDir, { recursive: true });

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

const storage = hasCloudinaryConfig()
  ? new CloudinaryStorage({
      cloudinary,
      params: {
        folder: "propertyos/maintenance",
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
    })
  : multer.memoryStorage();

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

function safeLocalFileName(originalName) {
  const ext = path.extname(originalName || "");
  const safeName = path
    .basename(originalName || "maintenance-photo", ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${Date.now()}-${safeName || "maintenance-photo"}${ext}`;
}

function uploadBufferToCloudinary(fileBuffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "propertyos/maintenance",
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

async function persistMaintenancePhotos(files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];

  return Promise.all(
    files.map(async (file) => {
      if (file.path) {
        return {
          url: file.path,
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          provider: "cloudinary",
          publicId: file.filename,
        };
      }

      if (hasCloudinaryConfig() && file.buffer) {
        const uploaded = await uploadBufferToCloudinary(file.buffer);
        return {
          url: uploaded.secure_url,
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          provider: "cloudinary",
          publicId: uploaded.public_id,
        };
      }

      const filename = safeLocalFileName(file.originalname);
      const filePath = path.join(uploadDir, filename);
      fs.writeFileSync(filePath, file.buffer);

      return {
        url: `/uploads/maintenance/${filename}`,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        provider: "local",
        publicId: filename,
      };
    })
  );
}

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

async function resolveTenant(req, organizationId) {
  const tokenTenantId = req.user?.tenantId || null;
  const userId = req.user?.userId || req.user?.id || null;
  const email = req.user?.email || null;

  if (tokenTenantId) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        id: tokenTenantId,
        organizationId,
      },
      include: {
        property: true,
        unit: true,
      },
    });

    if (tenant) return tenant;
  }

  if (userId) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId,
      },
      include: {
        tenant: {
          include: {
            property: true,
            unit: true,
          },
        },
      },
    });

    if (user?.tenant) return user.tenant;
  }

  if (email) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        organizationId,
        email,
      },
      include: {
        property: true,
        unit: true,
      },
    });

    if (tenant) return tenant;
  }

  return null;
}

async function notifyOrganizationAdminsAboutMaintenance(organizationId, request) {
  const admins = await prisma.user.findMany({
    where: {
      organizationId,
      isActive: true,
      role: {
        in: ["ADMIN", "OWNER"],
      },
    },
    select: {
      id: true,
      email: true,
    },
  });

  const uniqueAdminEmails = [
    ...new Set(
      admins
        .map((admin) => String(admin.email || "").trim())
        .filter(Boolean)
    ),
  ];

  const notificationMessage = `New maintenance request "${request.title}" was submitted by ${
    request.tenant
      ? `${request.tenant.firstName || ""} ${request.tenant.lastName || ""}`.trim() ||
        request.tenant.email ||
        "a tenant"
      : "a tenant"
  }.`;

  await Promise.allSettled(
    admins.map((admin) =>
      createNotification({
        userId: admin.id,
        title: "New maintenance request",
        message: notificationMessage,
        type: "ALERT",
        category: "MAINTENANCE",
      })
    )
  );

  if (uniqueAdminEmails.length === 0) {
    await sendMaintenanceCreatedToAdmin(request);
    return;
  }

  await Promise.allSettled(
    uniqueAdminEmails.map((email) => sendMaintenanceCreatedToAdmin(request, email))
  );
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

function detectMaintenanceClassification(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();
  const hasAny = (keywords) => keywords.some((keyword) => text.includes(keyword));

  let category = "GENERAL";

  if (
    hasAny([
      "water",
      "leak",
      "leaking",
      "pipe",
      "plumbing",
      "toilet",
      "sink",
      "drain",
      "faucet",
      "shower",
      "bathroom",
      "sewer",
      "flood",
    ])
  ) {
    category = "PLUMBING";
  } else if (
    hasAny([
      "electric",
      "electrical",
      "power",
      "outlet",
      "socket",
      "breaker",
      "light",
      "spark",
      "wire",
      "wiring",
    ])
  ) {
    category = "ELECTRICAL";
  } else if (
    hasAny(["heat", "heating", "ac", "a/c", "air conditioning", "hvac", "furnace", "thermostat"])
  ) {
    category = "HVAC";
  } else if (hasAny(["lock", "key", "door won't lock", "locked out", "deadbolt"])) {
    category = "LOCKS";
  } else if (hasAny(["paint", "wall", "ceiling", "drywall", "mold", "stain"])) {
    category = "PAINTING";
  } else if (hasAny(["pest", "bug", "insect", "roach", "cockroach", "mouse", "mice", "rat"])) {
    category = "PEST_CONTROL";
  } else if (
    hasAny([
      "fridge",
      "refrigerator",
      "oven",
      "stove",
      "dishwasher",
      "washer",
      "dryer",
      "appliance",
    ])
  ) {
    category = "APPLIANCE";
  }

  let priority = "MEDIUM";

  if (
    hasAny([
      "fire",
      "smoke",
      "spark",
      "gas",
      "flood",
      "flooding",
      "sewage",
      "no heat",
      "no heating",
      "no power",
      "electrical shock",
      "can't lock",
      "cannot lock",
      "door won't lock",
      "emergency",
    ])
  ) {
    priority = "URGENT";
  } else if (
    hasAny([
      "water",
      "leak",
      "leaking",
      "broken",
      "not working",
      "mold",
      "no hot water",
      "toilet clogged",
      "clogged toilet",
      "high",
    ])
  ) {
    priority = "HIGH";
  } else if (hasAny(["minor", "small", "low", "paint", "scratch"])) {
    priority = "LOW";
  }

  return { category, priority };
}

/* GET /api/tenant/maintenance */
router.get("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenant = await resolveTenant(req, organizationId);

    if (!tenant) {
      return res.status(403).json({
        error: "Unauthorized tenant",
        debug: {
          tokenTenantId: req.user?.tenantId || null,
          userId: req.user?.userId || req.user?.id || null,
          email: req.user?.email || null,
          organizationId,
        },
      });
    }

    const requests = await prisma.maintenanceRequest.findMany({
      where: {
        tenantId: tenant.id,
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
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(requests);
  } catch (error) {
    console.error("GET /api/tenant/maintenance error:", error);
    return res.status(500).json({
      error: "Failed to load tenant maintenance requests",
    });
  }
});

/* POST /api/tenant/maintenance */
router.post(
  "/",
  requireAuth,
  requireRole("TENANT"),
  uploadPhotos,
  async (req, res) => {
    try {
      const organizationId = requireOrg(req, res);
      if (!organizationId) return;

      const tenant = await resolveTenant(req, organizationId);

      if (!tenant) {
        return res.status(403).json({ error: "Unauthorized tenant" });
      }

      if (!tenant.propertyId) {
        return res.status(400).json({
          error: "Tenant has no property linked",
        });
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

      const detected = detectMaintenanceClassification(title, description);
      const safeCategory =
        category && isValidCategory(category) ? category : detected.category;

      const safePriority =
        priority && isValidPriority(priority) ? priority : detected.priority;

      const photos = await persistMaintenancePhotos(req.files);

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
          aiRecommendations: {
            where: { type: "CONTRACTOR_SUGGESTION" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
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

      try {
        await notifyOrganizationAdminsAboutMaintenance(organizationId, createdRequest);
      } catch (adminNotificationError) {
        console.error(
          "Tenant maintenance admin notification error:",
          adminNotificationError
        );
      }

      return res.status(201).json(createdRequest);
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

/* GET /api/tenant/maintenance/:id */
router.get("/:id", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenant = await resolveTenant(req, organizationId);

    if (!tenant) {
      return res.status(403).json({
        error: "Unauthorized tenant",
      });
    }

    const request = await prisma.maintenanceRequest.findFirst({
      where: {
        id: req.params.id,
        organizationId,
        tenantId: tenant.id,
      },
      include: {
        property: true,
        unit: true,
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        contractor: true,
        aiRecommendations: {
          where: { type: "CONTRACTOR_SUGGESTION" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!request) {
      return res.status(404).json({
        error: "Maintenance request not found for this tenant",
      });
    }

    return res.json(request);
  } catch (error) {
    console.error("GET /api/tenant/maintenance/:id error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load maintenance request",
    });
  }
});

/* PUT /api/tenant/maintenance/:id */
router.put("/:id", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const tenant = await resolveTenant(req, organizationId);

    if (!tenant) {
      return res.status(403).json({
        error: "Unauthorized tenant",
      });
    }

    const existing = await prisma.maintenanceRequest.findFirst({
      where: {
        id: req.params.id,
        organizationId,
        tenantId: tenant.id,
      },
    });

    if (!existing) {
      return res.status(404).json({
        error: "Maintenance request not found for this tenant",
      });
    }

    if (existing.status !== "OPEN") {
      return res.status(409).json({
        error: "Only OPEN maintenance requests can be edited by the tenant.",
      });
    }

    const {
      title,
      description,
      category,
      priority,
      preferredDate,
      entryPermission,
      locationNote,
    } = req.body || {};

    if (!title || String(title).trim() === "") {
      return res.status(400).json({ error: "Title is required" });
    }

    const safeCategory =
      category && isValidCategory(category) ? category : existing.category;

    const safePriority =
      priority && isValidPriority(priority) ? priority : existing.priority;

    const updated = await prisma.maintenanceRequest.update({
      where: { id: existing.id },
      data: {
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        category: safeCategory,
        priority: safePriority,
        preferredDate: parseOptionalDate(preferredDate),
        entryPermission:
          entryPermission === "true" || entryPermission === true,
        locationNote: locationNote ? String(locationNote).trim() : null,
      },
      include: {
        property: true,
        unit: true,
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        contractor: true,
        aiRecommendations: {
          where: { type: "CONTRACTOR_SUGGESTION" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    try {
      await createNotification({
        tenantId: tenant.id,
        title: "Maintenance request updated",
        message: `Your maintenance request "${updated.title}" was updated successfully.`,
        type: "INFO",
        category: "MAINTENANCE",
      });
    } catch (notificationError) {
      console.error("Tenant maintenance update notification error:", notificationError);
    }

    return res.json(updated);
  } catch (error) {
    console.error("PUT /api/tenant/maintenance/:id error:", error);
    return res.status(500).json({
      error: error.message || "Failed to update maintenance request",
    });
  }
});

module.exports = router;
