const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireSuperOwner } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.use(requireSuperOwner);

const PLATFORM_PERMISSIONS = [
  "platform:overview",
  "organizations:read",
  "properties:read",
  "tenants:read",
  "transactions:read",
  "audit:read",
  "support:read",
  "support:suspend_user",
  "support:reactivate_user",
];

async function getPlatformAccess(userId) {
  if (!userId) return { accessAll: false, permissions: [] };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      platformAccessAll: true,
      platformPermissions: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive || user.role !== "SUPER_OWNER") {
    return { accessAll: false, permissions: [] };
  }

  return {
    accessAll: user.platformAccessAll === true,
    permissions: Array.isArray(user.platformPermissions)
      ? user.platformPermissions
      : [],
  };
}

function hasPermission(access, permission) {
  return (
    access.accessAll ||
    access.permissions.includes(permission) ||
    access.permissions.includes("*")
  );
}

function requirePlatformPermission(permission) {
  return async (req, res, next) => {
    try {
      const access = await getPlatformAccess(req.user?.userId);

      if (!hasPermission(access, permission)) {
        return res.status(403).json({
          error: "Forbidden",
          requiredPermission: permission,
        });
      }

      req.platformAccess = access;
      next();
    } catch (error) {
      console.error("Platform permission error:", error);
      return res.status(500).json({ error: "Failed to verify permissions" });
    }
  };
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value) || 0;
}

function parseLimit(value, fallback = 50, max = 250) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDateFilter(query) {
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (!from && !to) return undefined;

  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

function assertSameOrganization(record, organizationId) {
  return record && record.organizationId === organizationId;
}

router.get("/permissions", async (req, res) => {
  try {
    const access = await getPlatformAccess(req.user?.userId);

    res.json({
      accessAll: access.accessAll,
      permissions: access.accessAll ? PLATFORM_PERMISSIONS : access.permissions,
      availablePermissions: PLATFORM_PERMISSIONS,
    });
  } catch (error) {
    console.error("Super owner permissions error:", error);
    res.status(500).json({ error: "Failed to load platform permissions" });
  }
});

router.get("/overview", requirePlatformPermission("platform:overview"), async (req, res) => {
  try {
    const [
      organizations,
      users,
      properties,
      tenants,
      payments,
      maintenance,
      auditEvents,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.property.count({ where: { isActive: true } }),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        _count: true,
      }),
      prisma.maintenanceRequest.count({
        where: { status: { in: ["OPEN", "IN_PROGRESS", "ON_HOLD"] } },
      }),
      prisma.systemAuditLog.count(),
    ]);

    const organizationSummaries = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        _count: {
          select: {
            properties: true,
            tenants: true,
            users: true,
            payments: true,
            maintenanceRequests: true,
          },
        },
        payments: {
          select: { amount: true },
        },
      },
    });

    res.json({
      stats: {
        organizations,
        users,
        properties,
        tenants,
        paymentCount: payments._count || 0,
        paymentVolume: toNumber(payments._sum.amount),
        openMaintenance: maintenance,
        auditEvents,
      },
      organizations: organizationSummaries.map((organization) => ({
        id: organization.id,
        name: organization.name,
        email: organization.email,
        companyName: organization.companyName,
        createdAt: organization.createdAt,
        counts: organization._count,
        paymentVolume: organization.payments.reduce(
          (sum, payment) => sum + toNumber(payment.amount),
          0
        ),
      })),
    });
  } catch (error) {
    console.error("Super owner overview error:", error);
    res.status(500).json({ error: "Failed to load platform overview" });
  }
});

router.get("/organizations", requirePlatformPermission("organizations:read"), async (req, res) => {
  try {
    const organizations = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            users: true,
            properties: true,
            tenants: true,
            payments: true,
            maintenanceRequests: true,
          },
        },
        users: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    res.json(
      organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        email: organization.email,
        phone: organization.phone,
        companyName: organization.companyName,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        counts: organization._count,
        users: organization.users,
      }))
    );
  } catch (error) {
    console.error("Super owner organizations error:", error);
    res.status(500).json({ error: "Failed to load organizations" });
  }
});

router.get("/organizations/:id", requirePlatformPermission("organizations:read"), async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        users: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
        properties: {
          include: {
            tenants: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
                leaseStartDate: true,
                leaseEndDate: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        tenants: {
          include: {
            property: {
              select: { id: true, name: true, code: true, city: true, state: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        payments: {
          include: {
            lease: {
              include: {
                tenant: true,
                property: true,
              },
            },
          },
          orderBy: { paymentDate: "desc" },
          take: 50,
        },
        maintenanceRequests: {
          include: {
            property: true,
            tenant: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        _count: {
          select: {
            users: true,
            properties: true,
            tenants: true,
            payments: true,
            maintenanceRequests: true,
          },
        },
      },
    });

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const paymentVolume = organization.payments.reduce(
      (sum, payment) => sum + toNumber(payment.amount),
      0
    );

    res.json({
      ...organization,
      paymentVolume,
    });
  } catch (error) {
    console.error("Super owner organization detail error:", error);
    res.status(500).json({ error: "Failed to load organization detail" });
  }
});

router.get("/transactions", requirePlatformPermission("transactions:read"), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 500);
    const organizationId = req.query.organizationId
      ? String(req.query.organizationId)
      : null;
    const paymentDate = buildDateFilter(req.query);

    const where = {
      ...(organizationId ? { organizationId } : {}),
      ...(paymentDate ? { paymentDate } : {}),
    };

    const payments = await prisma.payment.findMany({
      where,
      include: {
        organization: {
          select: { id: true, name: true, email: true, companyName: true },
        },
        lease: {
          include: {
            tenant: true,
            property: true,
          },
        },
      },
      orderBy: { paymentDate: "desc" },
      take: limit,
    });

    const grouped = new Map();

    for (const payment of payments) {
      const key = payment.organizationId || "unscoped";
      const current = grouped.get(key) || {
        organizationId: payment.organizationId,
        organizationName: payment.organization?.name || "Unscoped",
        count: 0,
        volume: 0,
      };

      current.count += 1;
      current.volume += toNumber(payment.amount);
      grouped.set(key, current);
    }

    res.json({
      groupedByOrganization: Array.from(grouped.values()).sort(
        (a, b) => b.volume - a.volume
      ),
      transactions: payments,
    });
  } catch (error) {
    console.error("Super owner transactions error:", error);
    res.status(500).json({ error: "Failed to load platform transactions" });
  }
});

router.get("/audit", requirePlatformPermission("audit:read"), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 500);
    const organizationId = req.query.organizationId
      ? String(req.query.organizationId)
      : null;
    const createdAt = buildDateFilter(req.query);

    const logs = await prisma.systemAuditLog.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      include: {
        actor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        organization: {
          select: { id: true, name: true, email: true, companyName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json(logs);
  } catch (error) {
    console.error("Super owner audit error:", error);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

router.patch("/organizations/:organizationId/users/:userId/reactivate", requirePlatformPermission("support:reactivate_user"), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
    });

    if (!assertSameOrganization(user, req.params.organizationId)) {
      return res.status(404).json({ error: "User not found in organization" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: true },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        organizationId: true,
      },
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Super owner reactivate user error:", error);
    res.status(500).json({ error: "Failed to reactivate user" });
  }
});

router.patch("/organizations/:organizationId/users/:userId/suspend", requirePlatformPermission("support:suspend_user"), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
    });

    if (!assertSameOrganization(user, req.params.organizationId)) {
      return res.status(404).json({ error: "User not found in organization" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        organizationId: true,
      },
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Super owner suspend user error:", error);
    res.status(500).json({ error: "Failed to suspend user" });
  }
});

module.exports = router;
