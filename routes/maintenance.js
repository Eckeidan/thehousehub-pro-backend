const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

const {
  sendEmail,
  buildMaintenanceCreatedEmail,
  buildMaintenanceApprovalEmail,
  buildMaintenanceAssignmentEmail,
} = require("../utils/sendEmail");

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

const aiRecommendationModel =
  prisma.aIRecommendation || prisma.aiRecommendation;

/* =========================
   EMAIL HELPERS
   ========================= */

const ADMIN_EMAIL =
  process.env.MAINTENANCE_ADMIN_EMAIL ||
  process.env.ADMIN_EMAIL ||
  process.env.SMTP_USER;

async function sendMaintenanceCreatedToAdmin(request) {
  if (!ADMIN_EMAIL) return;

  const tenantName = `${request?.tenant?.firstName || ""} ${
    request?.tenant?.lastName || ""
  }`.trim();

  const propertyName =
    request?.property?.name || request?.property?.code || "N/A";

  const propertyAddress =
    request?.property?.addressLine1 ||
    request?.property?.city ||
    request?.property?.code ||
    "N/A";

  const unitCode = request?.unit?.unitCode || request?.unit?.unitName || "N/A";

  const emailContent = buildMaintenanceCreatedEmail({
    requestNumber: request?.requestNumber,
    title: request?.title,
    description: request?.description,
    category: request?.category,
    priority: request?.priority,
    propertyName,
    propertyAddress,
    unitCode,
    tenantName: tenantName || "N/A",
    tenantEmail: request?.tenant?.email || "N/A",
    tenantPhone: request?.tenant?.phone || "N/A",
  });

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });
}

async function sendMaintenanceAssignedToContractor(request, contractor) {
  const to =
    contractor?.email ||
    request?.contractor?.email ||
    process.env.CONTRACTOR_TEST_EMAIL;

  if (!to) return;

  const propertyName =
    request?.property?.name || request?.property?.code || "N/A";

  const propertyAddress =
    [request?.property?.addressLine1, request?.property?.city]
      .filter(Boolean)
      .join(", ") || "N/A";

  const tenantName = `${request?.tenant?.firstName || ""} ${
    request?.tenant?.lastName || ""
  }`.trim();

  const formattedPreferredDate = request?.preferredDate
    ? new Date(request.preferredDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "N/A";

  const emailContent = buildMaintenanceAssignmentEmail({
    requestNumber: request?.requestNumber,
    title: request?.title,
    description: request?.description,
    category: request?.category,
    priority: request?.priority,
    preferredDate: formattedPreferredDate,
    propertyName,
    propertyAddress,
    unitCode: request?.unit?.unitCode || request?.unit?.unitName || "N/A",
    tenantName: tenantName || "N/A",
    tenantEmail: request?.tenant?.email || "N/A",
    tenantPhone: request?.tenant?.phone || "N/A",
    estimatedLaborCost: request?.estimatedLaborCost || "N/A",
    estimatedMaterialsCost: request?.estimatedMaterialsCost || "N/A",
    estimatedTotalCost:
      request?.estimatedTotalCost || request?.estimatedCost || "N/A",
    materialsNotes: request?.materialsNotes || "N/A",
  });

  await sendEmail({
    to,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });
}

async function sendMaintenanceApprovedToTenant(request, contractor) {
  if (!request?.tenant?.email) return;

  const emailContent = buildMaintenanceApprovalEmail({
    requestNumber: request?.requestNumber,
    title: request?.title,
    contractorName:
      contractor?.companyName || request?.contractor?.companyName || "N/A",
    estimatedLaborCost: request?.estimatedLaborCost || "N/A",
    estimatedMaterialsCost: request?.estimatedMaterialsCost || "N/A",
    estimatedTotalCost: request?.estimatedTotalCost || "N/A",
  });

  await sendEmail({
    to: request.tenant.email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });
}

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
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

function toDecimalString(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return num.toFixed(2);
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
  if (city && propertyCityNormalized && city === propertyCityNormalized) {
    score += 15;
  }

  const rating = Number(contractor.rating || 0);
  if (!Number.isNaN(rating) && rating > 0) {
    score += Math.min(rating * 2, 10);
  }

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

function sumCosts(laborCost, materialsCost) {
  const labor = Number(laborCost || 0);
  const materials = Number(materialsCost || 0);
  return (labor + materials).toFixed(2);
}

/* =========================
   AI LOGIC
   ========================= */

async function generateMaintenanceSuggestion(requestId, organizationId) {
  const request = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId },
    include: {
      property: true,
      unit: true,
      tenant: true,
      contractor: true,
    },
  });

  if (!request) {
    throw new Error("Maintenance request not found");
  }

  const contractors = await prisma.contractor.findMany({
    where: {
      organizationId,
      isActive: true,
    },
  });

  if (!contractors.length) {
    return null;
  }

  const propertyCity = request.property?.city || "";

  const ranked = contractors
    .map((contractor) => ({
      contractor,
      score: calculateContractorScore(contractor, request, propertyCity),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];

  if (!best || !best.contractor) {
    return null;
  }

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
    propertyCity,
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

/* =========================
   GET /api/maintenance
   ========================= */
router.get("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { status, priority, category, search, propertyId, unitId, tenantId } =
      req.query;

    const where = {
      organizationId,
      ...(status ? { status: String(status) } : {}),
      ...(priority ? { priority: String(priority) } : {}),
      ...(category ? { category: String(category) } : {}),
      ...(propertyId ? { propertyId: String(propertyId) } : {}),
      ...(unitId ? { unitId: String(unitId) } : {}),
      ...(tenantId ? { tenantId: String(tenantId) } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: String(search), mode: "insensitive" } },
              { description: { contains: String(search), mode: "insensitive" } },
              { requestNumber: { contains: String(search), mode: "insensitive" } },
              {
                property: {
                  organizationId,
                  OR: [
                    { name: { contains: String(search), mode: "insensitive" } },
                    { code: { contains: String(search), mode: "insensitive" } },
                    {
                      addressLine1: {
                        contains: String(search),
                        mode: "insensitive",
                      },
                    },
                    { city: { contains: String(search), mode: "insensitive" } },
                  ],
                },
              },
              {
                unit: {
                  organizationId,
                  OR: [
                    { unitCode: { contains: String(search), mode: "insensitive" } },
                    { unitName: { contains: String(search), mode: "insensitive" } },
                  ],
                },
              },
              {
                tenant: {
                  organizationId,
                  OR: [
                    { firstName: { contains: String(search), mode: "insensitive" } },
                    { lastName: { contains: String(search), mode: "insensitive" } },
                    { email: { contains: String(search), mode: "insensitive" } },
                    { phone: { contains: String(search), mode: "insensitive" } },
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
    console.error("Error fetching maintenance requests:", error);
    return res.status(500).json({ error: "Failed to fetch maintenance requests" });
  }
});

/* =========================
   GET /api/maintenance/stats
   ========================= */
router.get("/stats", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const [total, open, inProgress, resolved, urgent, closed] =
      await Promise.all([
        prisma.maintenanceRequest.count({ where: { organizationId } }),
        prisma.maintenanceRequest.count({ where: { organizationId, status: "OPEN" } }),
        prisma.maintenanceRequest.count({
          where: { organizationId, status: "IN_PROGRESS" },
        }),
        prisma.maintenanceRequest.count({
          where: { organizationId, status: "RESOLVED" },
        }),
        prisma.maintenanceRequest.count({
          where: { organizationId, priority: "URGENT" },
        }),
        prisma.maintenanceRequest.count({
          where: { organizationId, status: "CLOSED" },
        }),
      ]);

    return res.json({ total, open, inProgress, resolved, urgent, closed });
  } catch (error) {
    console.error("Error fetching maintenance stats:", error);
    return res.status(500).json({ error: "Failed to fetch maintenance stats" });
  }
});
/* GET /api/maintenance/:id/recommendation */
router.get("/:id/recommendation", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const request = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!request) return res.status(404).json({ error: "Maintenance request not found" });

    let recommendation = await aiRecommendationModel.findFirst({
      where: { maintenanceRequestId: req.params.id, type: "CONTRACTOR_SUGGESTION" },
      orderBy: { createdAt: "desc" },
    });

    if (!recommendation) {
      const suggestion = await generateMaintenanceSuggestion(req.params.id, organizationId);
      if (!suggestion) return res.status(404).json({ error: "No AI contractor recommendation available" });
      recommendation = await upsertMaintenanceRecommendation(req.params.id, suggestion);
    }

    return res.json(recommendation);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load recommendation" });
  }
});

/* POST /api/maintenance/:id/recommendation/refresh */
router.post("/:id/recommendation/refresh", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existingRequest = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!existingRequest) return res.status(404).json({ error: "Maintenance request not found" });

    const suggestion = await generateMaintenanceSuggestion(req.params.id, organizationId);
    if (!suggestion) return res.status(404).json({ error: "No contractor suggestion could be generated" });

    const recommendation = await upsertMaintenanceRecommendation(req.params.id, suggestion);
    return res.json(recommendation);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to refresh contractor recommendation" });
  }
});

/* GET /api/maintenance/:id */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const request = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
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

    if (!request) return res.status(404).json({ error: "Maintenance request not found" });

    return res.json(request);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch maintenance request" });
  }
});

/* POST /api/maintenance */
router.post("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

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
      locationNote,
    } = req.body;

    if (!propertyId) return res.status(400).json({ error: "Property is required" });
    if (!title) return res.status(400).json({ error: "Title is required" });

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId },
    });

    if (!property) return res.status(404).json({ error: "Property not found" });

    if (unitId) {
      const unit = await prisma.unit.findFirst({
        where: { id: unitId, organizationId },
      });

      if (!unit) return res.status(404).json({ error: "Unit not found" });

      if (unit.propertyId !== propertyId) {
        return res.status(400).json({ error: "Selected unit does not belong to the selected property" });
      }
    }

    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId, organizationId },
      });

      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    }

    const requestNumber = await generateUniqueRequestNumber();
    const safeCategory = category && isValidCategory(category) ? category : "GENERAL";
    const safePriority = priority && isValidPriority(priority) ? priority : "MEDIUM";

    const request = await prisma.maintenanceRequest.create({
      data: {
        organizationId,
        requestNumber,
        propertyId,
        unitId: unitId || null,
        tenantId: tenantId || null,
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        category: safeCategory,
        priority: safePriority,
        preferredDate: parseOptionalDate(preferredDate),
        entryPermission: Boolean(entryPermission),
        locationNote: locationNote ? String(locationNote).trim() : null,
      },
      include: {
        property: true,
        unit: true,
        tenant: true,
        contractor: true,
      },
    });

    try {
      const suggestion = await generateMaintenanceSuggestion(request.id, organizationId);
      if (suggestion) await upsertMaintenanceRecommendation(request.id, suggestion);
    } catch (aiError) {
      console.error("AI recommendation generation error:", aiError);
    }

    if (request.tenantId) {
      await createNotification({
        tenantId: request.tenantId,
        title: "Maintenance request created",
        message: `Your maintenance request "${request.title}" has been submitted successfully.`,
        type: "INFO",
        category: "MAINTENANCE",
      });
    }

    try {
      await sendMaintenanceCreatedToAdmin(request);
    } catch (mailError) {
      console.error("Admin maintenance email error:", mailError);
    }

    return res.status(201).json(request);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to create maintenance request" });
  }
});

/* POST /api/maintenance/:id/approve-contractor */
router.post("/:id/approve-contractor", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const request = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
      include: { property: true, unit: true, tenant: true },
    });

    if (!request) return res.status(404).json({ error: "Maintenance request not found" });

    const recommendation = await aiRecommendationModel.findFirst({
      where: { maintenanceRequestId: req.params.id, type: "CONTRACTOR_SUGGESTION" },
      orderBy: { createdAt: "desc" },
    });

    if (!recommendation?.aiSuggestion) {
      return res.status(404).json({ error: "No recommendation found" });
    }

    const contractorId = recommendation.aiSuggestion.contractorId;
    if (!contractorId) return res.status(400).json({ error: "Recommendation has no contractor assigned" });

    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        organizationId,
        isActive: true,
      },
    });
    if (!contractor) return res.status(404).json({ error: "Suggested contractor not found" });

    const estimatedTotalCost = recommendation.aiSuggestion.estimatedTotalCost;

    const updatedRequest = await prisma.maintenanceRequest.update({
      where: { id: req.params.id },
      data: {
        contractorId,
        estimatedLaborCost: toDecimalString(recommendation.aiSuggestion.estimatedLaborCost),
        estimatedMaterialsCost: toDecimalString(recommendation.aiSuggestion.estimatedMaterialsCost),
        estimatedTotalCost: toDecimalString(estimatedTotalCost),
        estimatedCost: toDecimalString(estimatedTotalCost),
        status: request.status === "OPEN" ? "IN_PROGRESS" : request.status,
      },
      include: { property: true, unit: true, tenant: true, contractor: true },
    });

    const updatedRecommendation = await aiRecommendationModel.update({
      where: { id: recommendation.id },
      data: { ownerDecision: "APPROVED" },
    });

    return res.json({
      message: "AI contractor suggestion approved successfully",
      request: updatedRequest,
      recommendation: updatedRecommendation,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to approve contractor suggestion" });
  }
});

/* POST /api/maintenance/:id/reject-contractor */
router.post("/:id/reject-contractor", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const request = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!request) return res.status(404).json({ error: "Maintenance request not found" });

    const recommendation = await aiRecommendationModel.findFirst({
      where: { maintenanceRequestId: req.params.id, type: "CONTRACTOR_SUGGESTION" },
      orderBy: { createdAt: "desc" },
    });

    if (!recommendation) return res.status(404).json({ error: "No recommendation found" });

    const updatedRecommendation = await aiRecommendationModel.update({
      where: { id: recommendation.id },
      data: { ownerDecision: "REJECTED" },
    });

    try {
  await sendMaintenanceAssignedToContractor(updatedRequest, contractor);
} catch (mailError) {
  console.error("Contractor assignment email error:", mailError);
}

try {
  await sendMaintenanceApprovedToTenant(updatedRequest, contractor);
} catch (mailError) {
  console.error("Tenant approval email error:", mailError);
}

    return res.json({ message: "AI contractor suggestion rejected", recommendation: updatedRecommendation });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to reject contractor suggestion" });
  }
});

/* PUT /api/maintenance/:id */
router.put("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existing = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!existing) return res.status(404).json({ error: "Maintenance request not found" });

    const request = await prisma.maintenanceRequest.update({
      where: { id: req.params.id },
      data: req.body || {},
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

    return res.json(request);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to update maintenance request" });
  }
});

/* PATCH /api/maintenance/:id/status */
router.patch("/:id/status", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const { status } = req.body;

    const existing = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!existing) return res.status(404).json({ error: "Maintenance request not found" });

    const updateData = { status };

    if (status === "RESOLVED") updateData.resolvedAt = new Date();
    if (status === "CLOSED") {
      updateData.completedAt = new Date();
      if (!existing.resolvedAt) updateData.resolvedAt = new Date();
    }

    const request = await prisma.maintenanceRequest.update({
      where: { id: req.params.id },
      data: updateData,
      include: { property: true, unit: true, tenant: true, contractor: true },
    });

    return res.json(request);
  } catch (error) {
    return res.status(500).json({ error: "Failed to update maintenance status" });
  }
});

/* DELETE /api/maintenance/:id */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existing = await prisma.maintenanceRequest.findFirst({
      where: { id: req.params.id, organizationId },
    });

    if (!existing) return res.status(404).json({ error: "Maintenance request not found" });

    await prisma.maintenanceRequest.delete({
      where: { id: req.params.id },
    });

    return res.json({ message: "Maintenance request deleted successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete maintenance request" });
  }
});

module.exports = router;