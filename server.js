const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const dashboardRoutes = require("./routes/dashboard");
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
const { router: reportsRoutes, runDueReportSchedules } = require("./routes/reports");
const usersRoutes = require("./routes/users");
const contractorsRoutes = require("./routes/contractors");
const tenantContactRoutes = require("./routes/tenantContact");
const communicationsRoutes = require("./routes/communications");
const tenantSettingsRoutes = require("./routes/tenantSettings");
const tenantMaintenanceRoutes = require("./routes/tenantMaintenance");
const tenantPaymentsRoutes = require("./routes/tenantPayments");
const publicRoutes = require("./routes/public");
const tenantChatbotRoutes = require("./routes/tenantChatbot");
const superOwnerRoutes = require("./routes/superOwner");
const { auditRequests } = require("./middleware/audit");


const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://propertyos-frontend.onrender.com",
  "https://thehousehub.app",
  "https://www.thehousehub.app",
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn("CORS blocked origin:", origin);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(auditRequests);

const uploadsPath = path.join(__dirname, "uploads");

app.use(
  "/uploads",
  express.static(uploadsPath, {
    fallthrough: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".docx")) {
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
      }

      if (filePath.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      }
    },
  })
);

console.log("Uploads served from:", uploadsPath);

app.get("/", (req, res) => {
  res.send("PropertyOS API is running");
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is healthy",
  });
});

/* API Routes */
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);

app.use("/api/dashboard", dashboardRoutes);
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
app.use("/api/reports", reportsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/contractors", contractorsRoutes);
app.use("/api/tenant/contact", tenantContactRoutes);
app.use("/api/communications", communicationsRoutes);
app.use("/api/tenant/settings", tenantSettingsRoutes);
app.use("/api/tenant/maintenance", tenantMaintenanceRoutes);
app.use("/api/tenant/payments", tenantPaymentsRoutes);
app.use("/api/tenant-chatbot", tenantChatbotRoutes);
app.use("/api/super-owner", superOwnerRoutes);

console.log("Dashboard route mounted: /api/dashboard");
console.log("Tenant contact route mounted: /api/tenant/contact");
console.log("Tenant chatbot route mounted: /api/tenant-chatbot");

if (process.env.DISABLE_REPORT_SCHEDULER !== "true") {
  setInterval(() => {
    runDueReportSchedules().catch((error) => {
      console.error("Scheduled report worker error:", error);
    });
  }, 15 * 60 * 1000);
}

app.use("/api", (req, res) => {
  return res.status(404).json({
    error: `API route not found: ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  if (req.originalUrl.startsWith("/api")) {
    return res.status(500).json({
      error: err.message || "Internal server error",
    });
  }

  return res.status(500).send("Internal server error");
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`PropertyOS API running on http://localhost:${PORT}`);
});
