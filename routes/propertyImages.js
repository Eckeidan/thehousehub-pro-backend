const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const prisma = require("../lib/prisma");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads", "properties");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const safeName = file.originalname
      .replace(ext, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    cb(null, `${Date.now()}-${safeName}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 2024 * 2024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
    }
    cb(null, true);
  },
});

/* GET all images for a property */
router.get("/property/:propertyId", async (req, res) => {
  try {
    const images = await prisma.propertyImage.findMany({
      where: { propertyId: req.params.propertyId },
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

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
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
      files.map((file, index) =>
        prisma.propertyImage.create({
          data: {
            propertyId,
            imageUrl: `/uploads/properties/${file.filename}`,
            fileName: file.originalname,
            isPrimary: currentCount === 0 && index === 0,
            sortOrder: currentCount + index,
          },
        })
      )
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
    const image = await prisma.propertyImage.findUnique({
      where: { id: req.params.imageId },
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
    const image = await prisma.propertyImage.findUnique({
      where: { id: req.params.imageId },
    });

    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    const filePath = path.join(__dirname, "..", image.imageUrl.replace(/^\//, ""));

    await prisma.propertyImage.delete({
      where: { id: image.id },
    });

    if (fs.existsSync(filePath)) {
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