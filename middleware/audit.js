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
          ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
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
