const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { recordPresence, sessionExpiryFromNow } = require("../lib/presence");

/**
 * AUTH MIDDLEWARE
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.sessionId) {
      return res.status(401).json({ error: "Session expired. Please login again." });
    }

    const session = await prisma.userSession.findUnique({
      where: { id: decoded.sessionId },
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
            role: true,
          },
        },
      },
    });

    const now = new Date();
    if (
      !session ||
      !session.isActive ||
      session.userId !== decoded.userId ||
      session.expiresAt <= now ||
      !session.user?.isActive
    ) {
      if (session?.isActive) {
        await prisma.userSession.update({
          where: { id: session.id },
          data: {
            isActive: false,
            logoutAt: now,
            logoutReason: session.expiresAt <= now ? "inactivity_timeout" : "invalid_session",
          },
        });
      }

      return res.status(401).json({ error: "Session expired. Please login again." });
    }

    req.user = decoded;
    req.session = session;
    recordPresence(req);

    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        expiresAt: sessionExpiryFromNow(),
      },
    });

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
