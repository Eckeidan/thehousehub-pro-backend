const express = require("express");
const multer = require("multer");
const streamifier = require("streamifier");
const prisma = require("../lib/prisma");
const cloudinary = require("../utils/cloudinary");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, or WEBP files are allowed"));
    }
    cb(null, true);
  },
});

function uploadToCloudinary(fileBuffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

/**
 * POST /api/tenant/payments
 * Tenant submits manual payment proof.
 */
router.post(
  "/",
  requireAuth,
  requireRole("TENANT"),
  upload.single("proof"),
  async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;

      if (!tenantId) {
        return res.status(403).json({ error: "Tenant profile not found" });
      }

      const { amount, paymentMethod, reference, notes } = req.body || {};

      const numericAmount = Number(amount);

      if (!numericAmount || numericAmount <= 0) {
        return res.status(400).json({ error: "Valid amount is required" });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          leases: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!tenant || !tenant.leases || tenant.leases.length === 0) {
        return res.status(400).json({ error: "No active lease found" });
      }

      const activeLease = tenant.leases[0];

      let proofImageUrl = null;
      let proofFileName = null;
      let proofMimeType = null;

      if (req.file) {
        const uploaded = await uploadToCloudinary(
          req.file.buffer,
          "propertyos/payment-proofs"
        );

        proofImageUrl = uploaded.secure_url;
        proofFileName = req.file.originalname;
        proofMimeType = req.file.mimetype;
      }

      const payment = await prisma.payment.create({
        data: {
          leaseId: activeLease.id,
          amount: numericAmount,
          paymentDate: new Date(),
          paymentMethod: paymentMethod || "BANK_TRANSFER",
          status: "PENDING",
          reference: reference?.trim() || null,
          notes: notes?.trim() || null,
          proofImageUrl,
          proofFileName,
          proofMimeType,
        },
      });

      return res.status(201).json({
        success: true,
        message: "Payment proof submitted successfully",
        payment,
      });
    } catch (error) {
      console.error("Tenant payment submit error:", error);
      return res.status(500).json({
        error: error.message || "Failed to submit payment",
      });
    }
  }
);

/**
 * GET /api/tenant/payments
 * Tenant payment history.
 */
router.get("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        leases: {
          include: {
            payments: {
              orderBy: { paymentDate: "desc" },
            },
          },
        },
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const payments = tenant.leases.flatMap((lease) => lease.payments || []);

    return res.json(payments);
  } catch (error) {
    console.error("Tenant payments history error:", error);
    return res.status(500).json({ error: "Failed to load payments" });
  }
});

module.exports = router;