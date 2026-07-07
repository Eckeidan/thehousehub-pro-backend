const activeUsers = new Map();
const SESSION_TIMEOUT_MINUTES = 10;

function sessionExpiryFromNow() {
  return new Date(Date.now() + SESSION_TIMEOUT_MINUTES * 60 * 1000);
}

function firstForwardedIp(value) {
  if (!value) return null;
  return String(value).split(",")[0]?.trim() || null;
}

function buildApproximateLocation(headers = {}) {
  const city = headers["x-vercel-ip-city"] || headers["cf-ipcity"];
  const region = headers["x-vercel-ip-country-region"] || headers["cf-region"];
  const country = headers["x-vercel-ip-country"] || headers["cf-ipcountry"];

  return {
    city: city ? decodeURIComponent(String(city)) : null,
    region: region ? String(region) : null,
    country: country ? String(country) : null,
  };
}

function getClientIp(req) {
  return (
    firstForwardedIp(req.headers?.["x-forwarded-for"]) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null
  );
}

function parseUserAgent(userAgent) {
  const raw = String(userAgent || "");
  const browser = raw.includes("Edg/")
    ? "Microsoft Edge"
    : raw.includes("Chrome/")
    ? "Chrome"
    : raw.includes("Safari/") && !raw.includes("Chrome/")
    ? "Safari"
    : raw.includes("Firefox/")
    ? "Firefox"
    : raw
    ? "Unknown browser"
    : "Unknown";

  const os = raw.includes("Mac OS X")
    ? "macOS"
    : raw.includes("Windows")
    ? "Windows"
    : raw.includes("Android")
    ? "Android"
    : raw.includes("iPhone") || raw.includes("iPad")
    ? "iOS"
    : raw.includes("Linux")
    ? "Linux"
    : "Unknown";

  return { browser, os };
}

function isPrivateIp(ipAddress) {
  const ip = String(ipAddress || "");
  return (
    !ip ||
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("::ffff:127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function locationLabel(ipAddress, location = {}) {
  const parts = [location.city, location.region, location.country].filter(Boolean);

  if (parts.length > 0) {
    return {
      label: parts.join(", "),
      precision: "Proxy-provided approximation",
    };
  }

  if (isPrivateIp(ipAddress)) {
    return {
      label: "Local or private network",
      precision: "Not publicly geolocatable",
    };
  }

  return {
    label: "Approximation unavailable",
    precision: "IP captured, no geo header",
  };
}

function recordPresence(req) {
  if (!req.user?.userId) return;

  const ipAddress = getClientIp(req);
  const userAgent = req.headers?.["user-agent"] || null;
  const approximateLocation = buildApproximateLocation(req.headers);
  const now = new Date();

  activeUsers.set(req.user.userId, {
    userId: req.user.userId,
    email: req.user.email || null,
    role: req.user.role || null,
    organizationId: req.user.organizationId || null,
    tenantId: req.user.tenantId || null,
    lastActivityAt: now,
    lastAction: `${req.method} ${req.originalUrl || req.url}`,
    lastPath: req.originalUrl || req.url,
    ipAddress,
    userAgent,
    device: parseUserAgent(userAgent),
    approximateLocation: locationLabel(ipAddress, approximateLocation),
  });
}

function getActivePresence(windowMinutes = 15) {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;

  for (const [userId, item] of activeUsers.entries()) {
    if (new Date(item.lastActivityAt).getTime() < cutoff) {
      activeUsers.delete(userId);
    }
  }

  return Array.from(activeUsers.values()).filter(
    (item) => new Date(item.lastActivityAt).getTime() >= cutoff
  );
}

module.exports = {
  buildApproximateLocation,
  firstForwardedIp,
  getActivePresence,
  getClientIp,
  isPrivateIp,
  locationLabel,
  parseUserAgent,
  recordPresence,
  SESSION_TIMEOUT_MINUTES,
  sessionExpiryFromNow,
};
