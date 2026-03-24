const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const prisma = require("../lib/prisma");
const { createNotification } = require("../utils/createNotification");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads", "documents");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
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
  fileFilter: function (req, file, cb) {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Unsupported file type. Only PDF, JPG, PNG, WEBP, DOC, and DOCX are allowed."
        )
      );
    }
  },
});

/* GET all documents */
router.get("/", async (req, res) => {
  try {
    const documents = await prisma.document.findMany({
      include: {
        property: true,
        tenant: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(documents);
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).json({ error: "Failed to fetch documents" });
  }

  if (document.accessibleToTenant && document.tenantId) {
  await createNotification({
    tenantId: document.tenantId,
    title: "New document available",
    message: `${document.documentName} has been shared with your account.`,
    type: "INFO",
    category: "DOCUMENT",
  });
}

});

/* GET single document */
router.get("/:id", async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: {
        property: true,
        tenant: true,
      },
    });

    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    res.json(document);
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

/* UPLOAD document */
router.post("/", upload.single("file"), async (req, res) => {
  try {
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

    const savedDocument = await prisma.document.create({
      data: {
        propertyId: propertyId || null,
        tenantId: tenantId || null,
        documentName: documentName.trim(),
        type: type || "OTHER",
        fileUrl: `/uploads/documents/${req.file.filename}`,
        mimeType: req.file.mimetype || null,
        accessibleToTenant: String(accessibleToTenant) === "true",
        uploadedBy: uploadedBy?.trim() || null,
        notes: notes?.trim() || null,
      },
      include: {
        property: true,
        tenant: true,
      },
    });

    res.status(201).json(savedDocument);
  } catch (error) {
    console.error("Error uploading document:", error);
    res.status(500).json({
            error: error.message || "Failed to upload document",
            });
            }
});

/* DELETE document */
router.delete("/:id", async (req, res) => {
  try {
    const existingDocument = await prisma.document.findUnique({
      where: { id: req.params.id },
    });

    if (!existingDocument) {
      return res.status(404).json({ error: "Document not found" });
    }

    const fileName = existingDocument.fileUrl?.split("/").pop();
    const absoluteFilePath = fileName
      ? path.join(uploadDir, fileName)
      : null;

    if (absoluteFilePath && fs.existsSync(absoluteFilePath)) {
      fs.unlinkSync(absoluteFilePath);
    }

    await prisma.document.delete({
      where: { id: req.params.id },
    });

    res.json({ message: "Document deleted successfully" });
  } catch (error) {
    console.error("Error deleting document:", error);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

module.exports = router;