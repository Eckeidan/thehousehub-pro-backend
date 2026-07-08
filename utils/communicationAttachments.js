const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadDir = path.join(__dirname, "..", "uploads", "communications");
fs.mkdirSync(uploadDir, { recursive: true });

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
  fileFilter(req, file, cb) {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(
        new Error("Only images, PDFs, Word, Excel, and text files are allowed")
      );
    }

    cb(null, true);
  },
});

function safeLocalFileName(originalName) {
  const ext = path.extname(originalName || "");
  const safeName = path
    .basename(originalName || "attachment", ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeName || "attachment"}${ext}`;
}

function uploadCommunicationAttachments(req, res, next) {
  upload.array("attachments", 5)(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "One or more attachments are too large. Max 10MB each.",
        });
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          error: "You can upload a maximum of 5 attachments per message.",
        });
      }
    }

    return res.status(400).json({
      error: error.message || "Attachment upload failed.",
    });
  });
}

async function persistCommunicationAttachments(files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];

  return files.map((file) => {
    const filename = safeLocalFileName(file.originalname);
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, file.buffer);

    return {
      url: `/uploads/communications/${filename}`,
      fileName: file.originalname || filename,
      mimeType: file.mimetype,
      size: file.size,
      kind: String(file.mimetype || "").startsWith("image/") ? "image" : "file",
      provider: "local",
    };
  });
}

function getCommunicationAttachments(message) {
  const metadata = message?.metadata;

  if (
    metadata &&
    typeof metadata === "object" &&
    Array.isArray(metadata.attachments)
  ) {
    return metadata.attachments;
  }

  return [];
}

function withCommunicationAttachments(message) {
  if (!message) return message;

  return {
    ...message,
    attachments: getCommunicationAttachments(message),
  };
}

module.exports = {
  uploadCommunicationAttachments,
  persistCommunicationAttachments,
  withCommunicationAttachments,
};
