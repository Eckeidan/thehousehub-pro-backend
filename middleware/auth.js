const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userRole = String(req.user.role || "").trim().toUpperCase();
    const allowedRoles = roles.map((role) => String(role).trim().toUpperCase());

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: "Forbidden",
        debug: {
          currentRole: userRole || null,
          allowedRoles,
        },
      });
    }

    next();
  };
}

function requireOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userRole = String(req.user.role || "").trim().toUpperCase();

  if (userRole !== "OWNER") {
    return res.status(403).json({ error: "Only owner can perform this action" });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userRole = String(req.user.role || "").trim().toUpperCase();

  if (userRole !== "ADMIN") {
    return res.status(403).json({ error: "Only admin can perform this action" });
  }

  next();
}

function requireAdminOrOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userRole = String(req.user.role || "").trim().toUpperCase();

  if (!["ADMIN", "OWNER"].includes(userRole)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    console.log("AUTH HEADER =", authHeader);

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("DECODED TOKEN =", decoded);

    req.user = decoded;
    next();
  } catch (error) {
    console.error("AUTH ERROR =", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = {
  requireAuth,
  requireRole,
  requireOwner,
  requireAdmin,
  requireAdminOrOwner,
};