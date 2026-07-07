const jwt = require("jsonwebtoken");
const { recordPresence } = require("../lib/presence");

/**
 * AUTH MIDDLEWARE
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    recordPresence(req);
    next();
  } catch (error) {
    console.error("AUTH ERROR =", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * ROLE CHECK
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userRole = String(req.user.role || "").trim().toUpperCase();
    const allowedRoles = roles.map((r) =>
      String(r).trim().toUpperCase()
    );

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: "Forbidden",
        debug: {
          currentRole: userRole,
          allowedRoles,
        },
      });
    }

    next();
  };
}

function requireAdmin(req, res, next) {
  return requireRole("ADMIN")(req, res, next);
}

function requireOwner(req, res, next) {
  return requireRole("OWNER")(req, res, next);
}

function requireAdminOrOwner(req, res, next) {
  return requireRole("ADMIN", "OWNER")(req, res, next);
}

function requireSuperOwner(req, res, next) {
  return requireRole("SUPER_OWNER")(req, res, next);
}

function requireAdminOwnerOrSuperOwner(req, res, next) {
  return requireRole("ADMIN", "OWNER", "SUPER_OWNER")(req, res, next);
}

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  requireOwner,
  requireAdminOrOwner,
  requireSuperOwner,
  requireAdminOwnerOrSuperOwner,
};
