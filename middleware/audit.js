const prisma = require("../lib/prisma");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_PATHS = ["/api/auth/login", "/api/auth/change-password"];

function inferResource(path) {
  const parts = String(path || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean);

  if (parts[0] === "api" && parts[1]) return parts[1];
  return parts[0] || "unknown";
}

function inferResourceId(path) {
  const parts = String(path || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean);

  const candidate = parts[parts.length - 1];
  if (!candidate || candidate === "api") return null;
  if (["create", "new", "login", "me"].includes(candidate)) return null;
  return candidate.length > 8 ? candidate : null;
}

function firstForwardedIp(value) {
  if (!value) return null;
  return String(value).split(",")[0]?.trim() || null;
}

function buildApproximateLocation(headers) {
  const city = headers["x-vercel-ip-city"] || headers["cf-ipcity"];
  const region = headers["x-vercel-ip-country-region"] || headers["cf-region"];
  const country = headers["x-vercel-ip-country"] || headers["cf-ipcountry"];

  return {
    city: city ? decodeURIComponent(String(city)) : null,
    region: region ? String(region) : null,
    country: country ? String(country) : null,
  };
}

function auditRequests(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    if (!req.originalUrl?.startsWith("/api")) return;
    if (!MUTATING_METHODS.has(req.method)) return;
    if (!req.user?.userId) return;

    const pathname = req.originalUrl.split("?")[0];
    const isSensitive = SENSITIVE_PATHS.some((path) => pathname.startsWith(path));

    const role = String(req.user.role || "").trim().toUpperCase();
    const metadata = isSensitive
      ? { sensitive: true }
      : {
          durationMs: Date.now() - startedAt,
          query: req.query || {},
          approximateLocation: buildApproximateLocation(req.headers),
        };

    prisma.systemAuditLog
      .create({
        data: {
          actorUserId: req.user.userId,
          actorEmail: req.user.email || null,
          actorRole: role || null,
          organizationId: req.user.organizationId || null,
          action: `${req.method} ${pathname}`,
          resource: inferResource(pathname),
          resourceId: inferResourceId(pathname),
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          ipAddress:
            firstForwardedIp(req.headers["x-forwarded-for"]) ||
            req.ip ||
            req.socket?.remoteAddress ||
            null,
          userAgent: req.headers["user-agent"] || null,
          metadata,
        },
      })
      .catch((error) => {
        console.error("Audit log write failed:", error.message);
      });
  });

  next();
}

module.exports = {
  auditRequests,
};
