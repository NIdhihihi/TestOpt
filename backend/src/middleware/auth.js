import jwt from "jsonwebtoken";

export function getJwtSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  return process.env.JWT_SECRET;
}

/**
 * Parses an HTTP Cookie header into a key/value map without mutating globals or adding dependencies.
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (typeof cookieHeader !== "string" || !cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const name = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

export function createAccessToken(user) {
  return jwt.sign(
    { sub: user.userId, email: user.email },
    getJwtSecret(),
    { expiresIn: "15m", issuer: "testopt", audience: "testopt-api" },
  );
}

export function requireAuth(req, res, next) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "A bearer token is required." });
  }
  try {
    req.auth = jwt.verify(header.slice(7), getJwtSecret(), { issuer: "testopt", audience: "testopt-api" });
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message.includes("JWT_SECRET") ? "Authentication is not configured." : "Your session is invalid or expired.",
    });
  }
}
