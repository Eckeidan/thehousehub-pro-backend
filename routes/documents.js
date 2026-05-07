const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createNotification } = require("../utils/createNotification");

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

const uploadDir = path.join(__dirname, "..", "uploads", "documents");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, "_");

    const uniqueName = `${Date.now()}-${baseName}${ext}`;
    cb(null, uniqueName);
  },
});

const allowedMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(
      new Error(
        "Unsupported file type. Only PDF, JPG, PNG, WEBP, DOC, and DOCX are allowed."
      )
    );
  },
});

/* GET /api/documents */
router.get("/", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const documents = await prisma.document.findMany({
      where: { organizationId },
      include: {
        property: true,
        tenant: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(documents);
  } catch (error) {
    console.error("Error fetching documents:", error);
    return res.status(500).json({ error: "Failed to fetch documents" });
  }
});

/* GET /api/documents/:id */
router.get("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
      include: {
        property: true,
        tenant: true,
      },
    });

    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    return res.json(document);
  } catch (error) {
    console.error("Error fetching document:", error);
    return res.status(500).json({ error: "Failed to fetch document" });
  }
});

/* POST /api/documents */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const {
      propertyId,
      tenantId,
      documentName,
      type,
      accessibleToTenant,
      uploadedBy,
      notes,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    if (!documentName || !documentName.trim()) {
      return res.status(400).json({ error: "Document name is required" });
    }

    let safePropertyId = null;
    let safeTenantId = null;

    if (propertyId) {
      const property = await prisma.property.findFirst({
        where: {
          id: propertyId,
          organizationId,
        },
      });

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      safePropertyId = property.id;
    }

    if (tenantId) {
      const tenant = await prisma.tenant.findFirst({
        where: {
          id: tenantId,
          organizationId,
        },
      });

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      safeTenantId = tenant.id;
    }

    const savedDocument = await prisma.document.create({
      data: {
        organizationId,
        propertyId: safePropertyId,
        tenantId: safeTenantId,
        documentName: documentName.trim(),
        type: type || "OTHER",
        fileUrl: `/uploads/documents/${req.file.filename}`,
        mimeType: req.file.mimetype || null,
        accessibleToTenant: String(accessibleToTenant) === "true",
        uploadedBy: uploadedBy?.trim() || req.user?.fullName || req.user?.email || null,
        notes: notes?.trim() || null,
      },
      include: {
        property: true,
        tenant: true,
      },
    });

    if (savedDocument.accessibleToTenant && savedDocument.tenantId) {
      try {
        await createNotification({
          tenantId: savedDocument.tenantId,
          title: "New document available",
          message: `${savedDocument.documentName} has been shared with your account.`,
          type: "INFO",
          category: "DOCUMENT",
        });
      } catch (notificationError) {
        console.error("Document notification error:", notificationError);
      }
    }

    return res.status(201).json(savedDocument);
  } catch (error) {
    console.error("Error uploading document:", error);
    return res.status(500).json({
      error: error.message || "Failed to upload document",
    });
  }
});

/* DELETE /api/documents/:id */
router.delete("/:id", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const existingDocument = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!existingDocument) {
      return res.status(404).json({ error: "Document not found" });
    }

    const fileName = existingDocument.fileUrl?.split("/").pop();
    const absoluteFilePath = fileName ? path.join(uploadDir, fileName) : null;

    if (absoluteFilePath && fs.existsSync(absoluteFilePath)) {
      fs.unlinkSync(absoluteFilePath);
    }

    await prisma.document.delete({
      where: { id: existingDocument.id },
    });

    return res.json({ message: "Document deleted successfully" });
  } catch (error) {
    console.error("Error deleting document:", error);
    return res.status(500).json({ error: "Failed to delete document" });
  }
});

module.exports = router;