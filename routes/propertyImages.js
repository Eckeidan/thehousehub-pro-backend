const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const streamifier = require("streamifier");
const prisma = require("../lib/prisma");
const cloudinary = require("../utils/cloudinary");
const { requireAuth, requireRole } = require("../middleware/auth");

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

const uploadDir = path.join(__dirname, "..", "uploads", "properties");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
    }
    cb(null, true);
  },
});

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

function safeLocalFileName(originalName) {
  const ext = path.extname(originalName || "");
  const safeName = path
    .basename(originalName || "property-image", ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${Date.now()}-${safeName || "property-image"}${ext}`;
}

function uploadToCloudinary(fileBuffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
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

async function persistPropertyImage(file, propertyId) {
  if (hasCloudinaryConfig()) {
    const uploaded = await uploadToCloudinary(
      file.buffer,
      `propertyos/properties/${propertyId}`
    );

    return {
      imageUrl: uploaded.secure_url,
      fileName: file.originalname,
    };
  }

  const filename = safeLocalFileName(file.originalname);
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, file.buffer);

  return {
    imageUrl: `/uploads/properties/${filename}`,
    fileName: file.originalname,
  };
}

async function deleteRemoteImage(imageUrl) {
  if (!imageUrl || !String(imageUrl).includes("res.cloudinary.com")) return;

  try {
    const withoutQuery = String(imageUrl).split("?")[0];
    const uploadIndex = withoutQuery.indexOf("/upload/");
    if (uploadIndex === -1) return;

    const publicPath = withoutQuery
      .slice(uploadIndex + "/upload/".length)
      .replace(/^v\d+\//, "")
      .replace(/\.[^.]+$/, "");

    if (publicPath) {
      await cloudinary.uploader.destroy(publicPath, { resource_type: "image" });
    }
  } catch (error) {
    console.error("Cloudinary property image delete error:", error);
  }
}

/* GET all images for a property */
router.get("/property/:propertyId", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const property = await prisma.property.findFirst({
      where: { id: req.params.propertyId, organizationId },
      select: { id: true },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const images = await prisma.propertyImage.findMany({
      where: { propertyId: property.id },
      orderBy: [
        { isPrimary: "desc" },
        { sortOrder: "asc" },
        { createdAt: "asc" },
      ],
    });

    res.json(images);
  } catch (error) {
    console.error("Error fetching property images:", error);
    res.status(500).json({ error: "Failed to fetch property images" });
  }
});

/* UPLOAD image(s) for a property */
router.post("/property/:propertyId", upload.array("images", 10), async (req, res) => {
  try {
    const { propertyId } = req.params;
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const property = await prisma.property.findFirst({
      where: { id: propertyId, organizationId },
      include: { propertyImages: true },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const currentCount = property.propertyImages.length;

    const created = await Promise.all(
      files.map(async (file, index) => {
        const persisted = await persistPropertyImage(file, propertyId);

        return prisma.propertyImage.create({
          data: {
            propertyId,
            imageUrl: persisted.imageUrl,
            fileName: persisted.fileName,
            isPrimary: currentCount === 0 && index === 0,
            sortOrder: currentCount + index,
          },
        });
      })
    );

    res.status(201).json(created);
  } catch (error) {
    console.error("Error uploading property images:", error);
    res.status(500).json({ error: "Failed to upload property images" });
  }
});

/* SET primary image */
router.put("/:imageId/primary", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const image = await prisma.propertyImage.findFirst({
      where: {
        id: req.params.imageId,
        property: { organizationId },
      },
    });

    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    await prisma.propertyImage.updateMany({
      where: { propertyId: image.propertyId },
      data: { isPrimary: false },
    });

    const updated = await prisma.propertyImage.update({
      where: { id: image.id },
      data: { isPrimary: true },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error setting primary image:", error);
    res.status(500).json({ error: "Failed to set primary image" });
  }
});

/* DELETE image */
router.delete("/:imageId", async (req, res) => {
  try {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const image = await prisma.propertyImage.findFirst({
      where: {
        id: req.params.imageId,
        property: { organizationId },
      },
    });

    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    const filePath = image.imageUrl?.startsWith("/")
      ? path.join(__dirname, "..", image.imageUrl.replace(/^\//, ""))
      : null;

    await prisma.propertyImage.delete({
      where: { id: image.id },
    });

    await deleteRemoteImage(image.imageUrl);

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const remaining = await prisma.propertyImage.findMany({
      where: { propertyId: image.propertyId },
      orderBy: { createdAt: "asc" },
    });

    if (remaining.length > 0 && !remaining.some((img) => img.isPrimary)) {
      await prisma.propertyImage.update({
        where: { id: remaining[0].id },
        data: { isPrimary: true },
      });
    }

    res.json({ message: "Image deleted successfully" });
  } catch (error) {
    console.error("Error deleting image:", error);
    res.status(500).json({ error: "Failed to delete image" });
  }
});

module.exports = router;
