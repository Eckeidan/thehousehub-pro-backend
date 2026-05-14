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

/* GET tenant payments */
router.get("/", requireAuth, requireRole("TENANT"), async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(403).json({ error: "Tenant profile not found" });
    }

    const payments = await prisma.rentPayment.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(
      payments.map((payment) => ({
        id: payment.id,
        amount: Number(payment.amountPaid || 0),
        paymentDate: payment.paymentDate || payment.createdAt,
        paymentMethod: payment.paymentMethod || "BANK_TRANSFER",
        status: payment.status,
        reference: payment.referenceNumber,
        notes: payment.notes,
      }))
    );
  } catch (error) {
    console.error("Tenant payments history error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load payments",
    });
  }
});

/* POST tenant payment */
router.post(
  "/",
  requireAuth,
  requireRole("TENANT"),
  upload.single("proof"),
  async (req, res) => {
    try {
      const tenantId = req.user?.tenantId;
      const organizationId = req.user?.organizationId;

      if (!tenantId || !organizationId) {
        return res.status(403).json({ error: "Tenant profile not found" });
      }

      const { amount, paymentMethod, reference, notes } = req.body || {};
      const numericAmount = Number(amount);

      if (!numericAmount || numericAmount <= 0) {
        return res.status(400).json({ error: "Valid amount is required" });
      }

      const tenant = await prisma.tenant.findFirst({
        where: {
          id: tenantId,
          organizationId,
        },
        include: {
          property: true,
        },
      });

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      if (!tenant.propertyId) {
        return res.status(400).json({
          error: "Tenant has no property linked",
        });
      }

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

      const payment = await prisma.rentPayment.create({
        data: {
          propertyId: tenant.propertyId,
          tenantId: tenant.id,
          amountDue:
            tenant.monthlyRent || tenant.property?.monthlyRent || numericAmount,
          amountPaid: numericAmount,
          paymentDate: new Date(),
          dueDate: new Date(),
          status: "PENDING",
          paymentMethod: paymentMethod || "BANK_TRANSFER",
          referenceNumber: reference ? String(reference).trim() : null,
          notes: notes ? String(notes).trim() : null,
        },
      });

      return res.status(201).json({
        success: true,
        message: "Payment proof submitted successfully",
        payment,
        proof: {
          proofImageUrl,
          proofFileName,
          proofMimeType,
        },
      });
    } catch (error) {
      console.error("Tenant payment submit error:", error);
      return res.status(500).json({
        error: error.message || "Failed to submit payment",
      });
    }
  }
);

module.exports = router;