import jwt from "jsonwebtoken";

function getSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  return process.env.JWT_SECRET;
}

export function createAccessToken(user) {
  return jwt.sign(
    { sub: user.userId, email: user.email },
    getSecret(),
    { expiresIn: "15m", issuer: "testopt", audience: "testopt-api" },
  );
}

export function requireAuth(req, res, next) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "A bearer token is required." });
  }
  try {
    req.auth = jwt.verify(header.slice(7), getSecret(), { issuer: "testopt", audience: "testopt-api" });
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message.includes("JWT_SECRET") ? "Authentication is not configured." : "Your session is invalid or expired." });
  }
}
