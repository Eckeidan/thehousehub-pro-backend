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

/* =========================
   CLOUDINARY UPLOAD CONFIG
========================= */

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "propertyos/maintenance",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    resource_type: "image",
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

/* =========================
   UTILS
========================= */

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function calculateEstimatedHours(priority) {
  switch (priority) {
    case "LOW":
      return 1;
    case "MEDIUM":
      return 2;
    case "HIGH":
      return 3;
    case "URGENT":
      return 4;
    default:
      return 2;
  }
}

function calculateContractorScore(contractor, request, propertyCity) {
  let score = 0;

  const category = normalizeText(request.category);
  const serviceCategory = normalizeText(contractor.serviceCategory);
  const specialties = normalizeText(contractor.specialties);
  const city = normalizeText(contractor.city);
  const propertyCityNormalized = normalizeText(propertyCity);

  if (serviceCategory && category && serviceCategory === category) score += 50;
  if (specialties && category && specialties.includes(category)) score += 25;
  if (city && propertyCityNormalized && city === propertyCityNormalized) score += 15;

  const rating = Number(contractor.rating || 0);
  if (!Number.isNaN(rating) && rating > 0) score += Math.min(rating * 2, 10);

  return score;
}

function rankedConfidenceFromSuggestion(suggestion) {
  let confidence = 65;

  if (
    normalizeText(suggestion.serviceCategory) ===
    normalizeText(suggestion.category)
  ) {
    confidence += 15;
  }

  if (
    normalizeText(suggestion.city) &&
    normalizeText(suggestion.city) === normalizeText(suggestion.propertyCity)
  ) {
    confidence += 10;
  }

  if (Number(suggestion.baseFee || 0) > 0) confidence += 3;
  if (Number(suggestion.hourlyRate || 0) > 0) confidence += 3;
  if (suggestion.rating) confidence += 4;

  return Math.min(confidence, 98);
}

function buildReasoningText(suggestion) {
  return `AI selected ${suggestion.contractorName} based on category match, city match, specialties, pricing, and request priority.`;
}

/* =========================
   AI LOGIC
========================= */

async function generateMaintenanceSuggestion(requestId) {
  const request = await prisma.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: {
      property: true,
      unit: true,
      tenant: true,
      contractor: true,
    },
  });

  if (!request) throw new Error("Maintenance request not found");

  const contractors = await prisma.contractor.findMany({
    where: { isActive: true },
  });

  if (!contractors.length) return null;

  const propertyCity = request.property?.city || "";

  const ranked = contractors
    .map((contractor) => ({
      contractor,
      score: calculateContractorScore(contractor, request, propertyCity),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const estimatedHours = calculateEstimatedHours(request.priority);
  const baseFee = Number(best.contractor.baseFee || 0);
  const hourlyRate = Number(best.contractor.hourlyRate || 0);
  const estimatedLaborCost = baseFee + hourlyRate * estimatedHours;

  let estimatedMaterialsCost = 25;

  if (request.category === "PLUMBING") {
    estimatedMaterialsCost = request.priority === "URGENT" ? 60 : 35;
  } else if (request.category === "ELECTRICAL") {
    estimatedMaterialsCost = request.priority === "URGENT" ? 55 : 30;
  } else if (request.category === "HVAC") {
    estimatedMaterialsCost = request.priority === "URGENT" ? 120 : 80;
  } else if (request.category === "LOCKS") {
    estimatedMaterialsCost = 45;
  } else if (request.category === "PAINTING") {
    estimatedMaterialsCost = 50;
  } else if (request.category === "PEST_CONTROL") {
    estimatedMaterialsCost = 40;
  } else if (request.category === "APPLIANCE") {
    estimatedMaterialsCost = 90;
  } else if (request.category === "GENERAL") {
    estimatedMaterialsCost = 20;
  }

  const estimatedTotalCost = estimatedLaborCost + estimatedMaterialsCost;

  return {
    contractorId: best.contractor.id,
    contractorName: best.contractor.companyName,
    serviceCategory: best.contractor.serviceCategory || null,
    city: best.contractor.city || null,
    rating:
      best.contractor.rating !== null && best.contractor.rating !== undefined
        ? Number(best.contractor.rating)
        : null,
    baseFee,
    hourlyRate,
    estimatedHours,
    estimatedLaborCost,
    estimatedMaterialsCost,
    estimatedTotalCost,
    estimatedCost: estimatedTotalCost,
    category: request.category || null,
    priority: request.priority || null,
    propertyCity: propertyCity || null,
    manualOverride: false,
  };
}

async function upsertMaintenanceRecommendation(requestId, suggestion) {
  const existingRecommendation = await aiRecommendationModel.findFirst({
    where: {
      maintenanceRequestId: requestId,
      type: "CONTRACTOR_SUGGESTION",
    },
    orderBy: { createdAt: "desc" },
  });

  const payload = {
    ownerDecision: "PENDING",
    confidenceScore: rankedConfidenceFromSuggestion(suggestion).toString(),
    aiSuggestion: suggestion,
    reasoning: buildReasoningText(suggestion),
    executedAt: null,
  };

  if (existingRecommendation) {
    return aiRecommendationModel.update({
      where: { id: existingRecommendation.id },
      data: payload,
    });
  }

  return aiRecommendationModel.create({
    data: {
      type: "CONTRACTOR_SUGGESTION",
      maintenanceRequestId: requestId,
      ...payload,
    },
  });
}

async function autoCreateAIRecommendation(requestId) {
  try {
    const suggestion = await generateMaintenanceSuggestion(requestId);

    if (!suggestion) {
      console.log("Auto AI skipped: no active contractor found");
      return null;
    }

    const recommendation = await upsertMaintenanceRecommendation(
      requestId,
      suggestion
    );

    console.log("Auto AI created:", recommendation.id);
    return recommendation;
  } catch (error) {
    console.error("Auto AI generation error:", error.message);
    return null;
  }
}

/* =========================
   GET /api/tenant/maintenance
========================= */

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

/* =========================
   POST /api/tenant/maintenance
========================= */

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
            url: file.path,
            publicId: file.filename,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            provider: "cloudinary",
          }))
        : [];

      const requestNumber = await generateUniqueRequestNumber();

      const createdRequest = await prisma.maintenanceRequest.create({
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

      let recommendation = null;

      try {
        recommendation = await autoCreateAIRecommendation(createdRequest.id);
      } catch (aiError) {
        console.error("Tenant maintenance AI error:", aiError.message);
      }

      try {
        await createNotification({
          tenantId: tenant.id,
          title: "Maintenance request created",
          message: `Your maintenance request "${createdRequest.title}" has been submitted successfully.`,
          type: "INFO",
          category: "MAINTENANCE",
        });
      } catch (notificationError) {
        console.error(
          "Tenant maintenance notification error:",
          notificationError
        );
      }

      const request = await prisma.maintenanceRequest.findUnique({
        where: { id: createdRequest.id },
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

      return res.status(201).json({
        ...(request || createdRequest),
        aiRecommendations:
          request?.aiRecommendations ||
          (recommendation ? [recommendation] : []),
      });
    } catch (error) {
      console.error("POST /api/tenant/maintenance error:", error);

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            error:
              "One or more photos are too large. Please upload images smaller than 5MB each.",
          });
        }

        if (error.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({
            error: "You can upload a maximum of 5 photos per request.",
          });
        }
      }

      return res.status(500).json({
        error: error?.message || "Failed to create maintenance request",
      });
    }
  }
);

module.exports = router;