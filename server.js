const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const prisma = require("./lib/prisma");

const authRoutes = require("./routes/auth");
const propertiesRoutes = require("./routes/properties");
const propertyImagesRoutes = require("./routes/propertyImages");
const tenantsRoutes = require("./routes/tenants");
const tenantAccountsRoutes = require("./routes/tenantAccounts");
const tenantNotificationsRoutes = require("./routes/tenantNotifications");
const maintenanceRoutes = require("./routes/maintenance");
const unitsRoutes = require("./routes/units");
const leasesRoutes = require("./routes/leases");
const paymentsRoutes = require("./routes/payments");
const documentsRoutes = require("./routes/documents");
const settingsRoutes = require("./routes/settings");
const insightsRoutes = require("./routes/insights");
const usersRoutes = require("./routes/users");



const app = express();

/* Middlewares */
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Static files */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* API Routes */
app.use("/api/auth", authRoutes);

app.use("/api/properties", propertiesRoutes);
app.use("/api/property-images", propertyImagesRoutes);
app.use("/api/tenants", tenantsRoutes);
app.use("/api/tenants", tenantAccountsRoutes);
app.use("/api", tenantNotificationsRoutes);

app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/units", unitsRoutes);
app.use("/api/leases", leasesRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/insights", insightsRoutes);
app.use("/api/users", usersRoutes);

/* Health check */
app.get("/", (req, res) => {
  res.send("PropertyOS API is running");
});

/* Dashboard */
app.get("/api/dashboard", async (req, res) => {
  try {
    const [properties, tenants, maintenanceRequests, units] = await Promise.all([
      prisma.property.findMany({
        select: {
          id: true,
          unitsCount: true,
          isActive: true,
        },
      }),
      prisma.tenant.findMany({
        select: {
          id: true,
          isActive: true,
        },
      }),
      prisma.maintenanceRequest.findMany({
        select: {
          id: true,
          status: true,
        },
      }),
      prisma.unit.findMany({
        select: {
          id: true,
          occupancyStatus: true,
          isActive: true,
        },
      }),
    ]);

    const totalProperties = properties.length;
    const totalUnits =
      units.length > 0
        ? units.filter((unit) => unit.isActive).length
        : properties.reduce((sum, property) => sum + (property.unitsCount || 0), 0);

    const totalTenants = tenants.filter((tenant) => tenant.isActive).length;

    const openMaintenance = maintenanceRequests.filter(
      (item) => item.status !== "CLOSED" && item.status !== "CANCELLED"
    ).length;

    const occupancyRate =
      totalUnits > 0 ? Math.round((totalTenants / totalUnits) * 100) : 0;

    res.json({
      totalProperties,
      totalUnits,
      totalTenants,
      occupancyRate,
      openMaintenance,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`PropertyOS API running on http://localhost:${PORT}`);
});