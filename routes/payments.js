const express = require("express");
const prisma = require("../lib/prisma");
const { createNotification } = require("../utils/createNotification");
const { requireAuth, requireRole } = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/* -------------------- UPLOAD SETUP -------------------- */

const proofsDir = path.join(__dirname, "..", "uploads", "payment-proofs");

if (!fs.existsSync(proofsDir)) {
  fs.mkdirSync(proofsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, proofsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeBase = path
      .basename(file.originalname || "proof", ext)
      .replace(/[^a-zA-Z0-9-_]/g, "_");

    cb(cb ? null : null, `${Date.now()}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];

    if (
      allowedMimeTypes.includes(file.mimetype) &&
      allowedExt.includes(ext)
    ) {
      return cb(null, true);
    }

    return cb(
      new Error("Only JPG, JPEG, PNG, WEBP, and PDF files are allowed.")
    );
  },
});

/* -------------------- HELPERS -------------------- */

function getMonthRange(dateInput) {
  const date = new Date(dateInput);

  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return { start, end };
}

function resolveLeaseMonthlyRent(lease) {
  const possibleFields = [
    lease?.monthlyRent,
    lease?.rentAmount,
    lease?.monthly_rent,
    lease?.rent,
  ];

  const found = possibleFields.find(
    (value) => value !== undefined && value !== null && !isNaN(Number(value))
  );

  return found !== undefined ? Number(found) : null;
}

async function getMonthlyPaidTotal(
  leaseId,
  paymentDate,
  excludePaymentId = null
) {
  const { start, end } = getMonthRange(paymentDate);

  const where = {
    leaseId,
    paymentDate: {
      gte: start,
      lt: end,
    },
  };

  if (excludePaymentId) {
    where.id = { not: excludePaymentId };
  }

  const payments = await prisma.payment.findMany({
    where,
    select: {
      amount: true,
      status: true,
    },
  });

  return payments.reduce((sum, payment) => {
    const status = String(payment.status || "").toUpperCase();

    if (["CANCELLED", "FAILED", "VOID", "REFUNDED"].includes(status)) {
      return sum;
    }

    return sum + Number(payment.amount || 0);
  }, 0);
}
function getAuthUserId(req) {
  return req.user?.id || req.user?.userId || req.user?.sub || null;
}

async function findActiveLeaseForTenant(tenantId) {
  const leases = await prisma.lease.findMany({
    where: {
      tenantId,
    },
    include: {
      tenant: true,
      unit: true,
      property: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!leases.length) return null;

  const preferredStatuses = ["ACTIVE", "CURRENT", "ONGOING"];
  const normalized = leases.map((lease) => ({
    ...lease,
    _status: String(lease.status || "").toUpperCase(),
  }));

  const preferred =
    normalized.find((lease) => preferredStatuses.includes(lease._status)) ||
    normalized.find((lease) => !lease._status) ||
    normalized[0];

  delete preferred._status;
  return preferred;
}

async function removePaymentProofFile(payment) {
  try {
    if (!payment?.proofImageUrl) return;

    const fileName = path.basename(payment.proofImageUrl);
    const fullPath = path.join(proofsDir, fileName);

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    console.error("Failed to remove payment proof file:", error);
  }
}

/* -------------------- GET ALL -------------------- */

router.get("/", requireAuth, async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
      orderBy: {
        paymentDate: "desc",
      },
    });

    res.json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch payments",
    });
  }
});

/* -------------------- TENANT ACTIVE LEASE SUMMARY -------------------- */

router.get(
  "/tenant-summary",
  requireAuth,
  requireRole("TENANT"),
  async (req, res) => {
    try {
      console.log("TENANT SUMMARY req.user =", req.user);

      const userId = req.user?.userId || req.user?.id || req.user?.sub;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          tenant: {
            include: {
              property: true,
              unit: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantId = user.tenant?.id || user.tenantId;

      if (!tenantId) {
        return res.status(400).json({
          error: "No tenant profile linked to this account",
        });
      }

      const lease = await findActiveLeaseForTenant(tenantId);

      if (!lease) {
        return res.json({
          lease: null,
          monthlyRent: 0,
        });
      }

      const monthlyRent = resolveLeaseMonthlyRent(lease) || 0;

      return res.json({
        lease,
        monthlyRent,
      });
    } catch (error) {
      console.error("Error fetching tenant payment summary:", error);
      return res.status(500).json({
        error: error.message || "Failed to fetch tenant payment summary",
      });
    }
  }
);

/* -------------------- GET ONE -------------------- */

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    res.json(payment);
  } catch (error) {
    console.error("Error fetching payment:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch payment",
    });
  }
});

/* -------------------- CREATE BY ADMIN -------------------- */

router.post("/", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const {
      leaseId,
      amount,
      paymentDate,
      paymentMethod,
      status,
      reference,
      notes,
    } = req.body;

    if (!leaseId || !amount || !paymentDate) {
      return res.status(400).json({
        error: "leaseId, amount, and paymentDate are required",
      });
    }

    const parsedAmount = Number(amount);
    const parsedDate = new Date(paymentDate);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: "Amount must be valid and > 0",
      });
    }

    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        error: "Invalid payment date",
      });
    }

    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        tenant: true,
        unit: true,
        property: true,
      },
    });

    if (!lease) {
      return res.status(404).json({ error: "Lease not found" });
    }

    const monthlyRent = resolveLeaseMonthlyRent(lease);

    if (!monthlyRent || monthlyRent <= 0) {
      return res.status(400).json({
        error: "Lease has no valid rent",
      });
    }

    const totalPaid = await getMonthlyPaidTotal(leaseId, parsedDate);
    const remaining = monthlyRent - totalPaid;

    if (remaining <= 0) {
      return res.status(400).json({
        error: "Rent already fully paid",
      });
    }

    if (parsedAmount > remaining) {
      return res.status(400).json({
        error: `Exceeds remaining balance (${remaining})`,
      });
    }

    const payment = await prisma.payment.create({
      data: {
        leaseId,
        amount: parsedAmount,
        paymentDate: parsedDate,
        paymentMethod: paymentMethod || "CASH",
        status: status || "PAID",
        reference: reference || null,
        notes: notes || null,
      },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
    });

    if (payment?.lease?.tenant?.id) {
      await createNotification({
        tenantId: payment.lease.tenant.id,
        title: "Payment received",
        message: `Payment of $${payment.amount} received`,
        type: "SUCCESS",
        category: "PAYMENT",
      });
    }

    res.status(201).json(payment);
  } catch (error) {
    console.error("Error creating payment:", error);
    res.status(500).json({
      error: error.message || "Failed to create payment",
    });
  }
});

/* -------------------- TENANT INITIATE PAYMENT -------------------- */

router.post(
  "/tenant-initiate",
  requireAuth,
  requireRole("TENANT"),
  upload.single("proof"),
  async (req, res) => {
    try {
      const userId = req.user?.id || req.user?.userId || req.user?.sub;
      const { amount, paymentMethod, reference, notes, paymentDate } = req.body;

      const parsedAmount = Number(amount);
      const parsedDate = paymentDate ? new Date(paymentDate) : new Date();

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          error: "Amount must be valid and greater than 0",
        });
      }

      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          error: "Invalid payment date",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          tenant: {
            include: {
              property: true,
              unit: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const tenantId = user.tenant?.id || user.tenantId;

      if (!tenantId) {
        return res.status(400).json({
          error: "No tenant profile linked to this account",
        });
      }

      const lease = await findActiveLeaseForTenant(tenantId);

      if (!lease) {
        return res.status(404).json({
          error: "No active lease found for this tenant",
        });
      }

      const monthlyRent = resolveLeaseMonthlyRent(lease);

      if (!monthlyRent || monthlyRent <= 0) {
        return res.status(400).json({
          error: "Lease has no valid rent configured",
        });
      }

      const totalPaid = await getMonthlyPaidTotal(lease.id, parsedDate);
      const remaining = monthlyRent - totalPaid;

      if (remaining <= 0) {
        return res.status(400).json({
          error: "This month is already fully paid",
        });
      }

      if (parsedAmount > remaining) {
        return res.status(400).json({
          error: `Payment exceeds this month's remaining balance (${remaining})`,
        });
      }

      const normalizedMethod = String(
        paymentMethod || "BANK_TRANSFER"
      ).toUpperCase();

      const allowedMethods = [
        "CASH",
        "BANK_TRANSFER",
        "CARD",
        "MOBILE_MONEY",
        "CHECK",
      ];

      if (!allowedMethods.includes(normalizedMethod)) {
        return res.status(400).json({
          error: "Invalid payment method",
        });
      }

      const proofImageUrl = req.file
        ? `/uploads/payment-proofs/${req.file.filename}`
        : null;

      const createdPayment = await prisma.payment.create({
        data: {
          leaseId: lease.id,
          amount: parsedAmount,
          paymentDate: parsedDate,
          paymentMethod: normalizedMethod,
          status: "PENDING",
          reference: reference || null,
          notes: notes || null,
          proofImageUrl,
          proofFileName: req.file?.originalname || null,
          proofMimeType: req.file?.mimetype || null,
        },
        include: {
          lease: {
            include: {
              tenant: true,
              unit: true,
              property: true,
            },
          },
        },
      });

      if (lease.tenant?.id) {
        await createNotification({
          tenantId: lease.tenant.id,
          title: "Payment initiated",
          message: `Your payment request of $${parsedAmount} has been submitted and is awaiting confirmation.`,
          type: "INFO",
          category: "PAYMENT",
        });
      }

      return res.status(201).json({
        message: "Payment initiated successfully",
        payment: createdPayment,
        summary: {
          monthlyRent,
          alreadyCommitted: totalPaid,
          remainingBefore: remaining,
          remainingAfter: remaining - parsedAmount,
        },
      });
    } catch (error) {
      console.error("Error initiating tenant payment:", error);

      if (req.file) {
        try {
          const uploadedPath = path.join(proofsDir, req.file.filename);
          if (fs.existsSync(uploadedPath)) {
            fs.unlinkSync(uploadedPath);
          }
        } catch (cleanupError) {
          console.error("Failed to clean uploaded proof:", cleanupError);
        }
      }

      return res.status(500).json({
        error: error.message || "Failed to initiate tenant payment",
      });
    }
  }
);

/* -------------------- UPDATE -------------------- */

router.put("/:id", requireAuth, requireRole("ADMIN", "OWNER"), async (req, res) => {
  try {
    const existingPayment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        lease: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!existingPayment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const nextStatus = req.body?.status
      ? String(req.body.status).toUpperCase()
      : existingPayment.status;

    const updatedPayment = await prisma.payment.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        status: nextStatus,
      },
      include: {
        lease: {
          include: {
            tenant: true,
            unit: true,
            property: true,
          },
        },
      },
    });

    if (
      existingPayment.lease?.tenant?.id &&
      String(existingPayment.status || "").toUpperCase() !== nextStatus
    ) {
      if (nextStatus === "PAID") {
        await createNotification({
          tenantId: existingPayment.lease.tenant.id,
          title: "Payment approved",
          message: `Your payment of $${updatedPayment.amount} has been approved.`,
          type: "SUCCESS",
          category: "PAYMENT",
        });
      }

      if (nextStatus === "FAILED") {
        await createNotification({
          tenantId: existingPayment.lease.tenant.id,
          title: "Payment failed",
          message: `Your payment of $${updatedPayment.amount} was marked as failed.`,
          type: "ERROR",
          category: "PAYMENT",
        });
      }
    }

    res.json(updatedPayment);
  } catch (error) {
    console.error("Error updating payment:", error);
    res.status(500).json({
      error: error.message || "Failed to update payment",
    });
  }
});

/* -------------------- DELETE -------------------- */

router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
    });

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    await prisma.payment.delete({
      where: { id: req.params.id },
    });

    await removePaymentProofFile(payment);

    res.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Error deleting payment:", error);
    res.status(500).json({
      error: error.message || "Failed to delete payment",
    });
  }
});

module.exports = router;