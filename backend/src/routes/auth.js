import { Router } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import pool from "../db/connection.js";
import { createAccessToken, parseCookies, requireAuth } from "../middleware/auth.js";
import { requireOrganizationRole } from "../middleware/authorization.js";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  sendVerificationEmail,
} from "../services/emailService.js";
import {
  OAUTH_STATE_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  getAllowedOrigins,
  isTrustedOrigin,
  issueOAuthState,
  issueSession,
  revokeAllUserSessions,
  revokeRefreshTokenFamily,
  rotateRefreshToken,
  setRefreshCookie,
  verifyOAuthState,
} from "../services/sessionService.js";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ORG_ROLES = new Set(["OWNER", "ADMIN", "TEST_MANAGER", "DEVELOPER"]);

function authLimiter({ envKey, defaultMax, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: () => {
      const parsed = Number(process.env[envKey]);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMax;
    },
    skipSuccessfulRequests,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many authentication attempts. Please try again later." },
  });
}

const sendOtpLimiter = authLimiter({ envKey: "AUTH_RATE_LIMIT_OTP", defaultMax: 10 });
const verifyOtpLimiter = authLimiter({ envKey: "AUTH_RATE_LIMIT_OTP_VERIFY", defaultMax: 15 });
const loginLimiter = authLimiter({ envKey: "AUTH_RATE_LIMIT_LOGIN", defaultMax: 20, skipSuccessfulRequests: true });
const refreshLimiter = authLimiter({ envKey: "AUTH_RATE_LIMIT_REFRESH", defaultMax: 60 });

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new Error(`${name} is required and must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function getFrontendRedirectUrl() {
  const allowed = getAllowedOrigins();
  const configured = process.env.FRONTEND_URL?.trim();
  if (configured && allowed.includes(configured)) return configured;
  return allowed[0] || "http://localhost:5173";
}

/**
 * Resolves an existing OAuth user by immutable provider identity or creates a fresh
 * OAuth-backed account. Refuses to auto-merge across existing LOCAL or differing accounts.
 */
export async function handleOAuthUser({ email, name, provider, providerId }) {
  const normalizedEmail = email.toLowerCase().trim();
  const [byProvider] = await pool.query(
    `SELECT user_id AS userId, name, email, role, email_verified AS emailVerified
     FROM users
     WHERE auth_provider = ? AND auth_provider_id = ?`,
    [provider, providerId],
  );

  if (byProvider.length > 0) {
    const user = byProvider[0];
    if (!user.emailVerified) {
      await pool.query("UPDATE users SET email_verified = TRUE WHERE user_id = ?", [user.userId]);
    }
    const [organizations] = await pool.query(
      "SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role FROM organization_members om JOIN organizations o ON o.organization_id = om.organization_id WHERE om.user_id = ? ORDER BY o.organization_name",
      [user.userId],
    );
    return { user: { userId: user.userId, name: user.name, email: user.email }, organizations, isNew: false };
  }

  const [existingByEmail] = await pool.query(
    "SELECT user_id AS userId, auth_provider AS authProvider FROM users WHERE email = ?",
    [normalizedEmail],
  );

  if (existingByEmail.length > 0) {
    throw Object.assign(
      new Error("An account with this email already exists using another sign-in method. Sign in with your original method instead."),
      { statusCode: 409 },
    );
  }

  const connection = await pool.getConnection();
  try {
    const userId = `USR_${randomUUID()}`;
    const organizationId = `ORG_${randomUUID()}`;
    const safeName = typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "User";
    const organizationName = `${safeName} Workspace`.slice(0, 150);

    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO users (user_id, name, email, password_hash, role, email_verified, auth_provider, auth_provider_id) VALUES (?, ?, ?, NULL, 'DEVELOPER', TRUE, ?, ?)",
      [userId, safeName, normalizedEmail, provider, providerId],
    );
    await connection.query(
      "INSERT INTO organizations (organization_id, organization_name) VALUES (?, ?)",
      [organizationId, organizationName],
    );
    await connection.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'OWNER')",
      [organizationId, userId],
    );
    await connection.commit();

    const user = { userId, name: safeName, email: normalizedEmail };
    return {
      user,
      organizations: [{ organizationId, organizationName, role: "OWNER" }],
      isNew: true,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * POST /api/auth/send-otp
 * Dispatches a 6-digit verification code to the requested email address.
 */
router.post("/send-otp", sendOtpLimiter, async (req, res) => {
  try {
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 100) : "there";
    if (!emailPattern.test(email)) throw new Error("email must be valid.");

    const [existing] = await pool.query("SELECT user_id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: "An account already exists for this email. Please sign in." });
    }

    const [recent] = await pool.query(
      "SELECT id FROM email_verification_codes WHERE email = ? AND created_at > NOW() - INTERVAL 60 SECOND ORDER BY created_at DESC LIMIT 1",
      [email],
    );
    if (recent.length > 0) {
      return res.status(429).json({ success: false, message: "Please wait 60 seconds before requesting another code." });
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp, email);

    await pool.query("DELETE FROM email_verification_codes WHERE email = ?", [email]);
    const [insertResult] = await pool.query(
      "INSERT INTO email_verification_codes (email, otp_hash, purpose, expires_at) VALUES (?, ?, 'REGISTRATION', NOW() + INTERVAL 10 MINUTE)",
      [email, otpHash],
    );

    try {
      const result = await sendVerificationEmail({ email, otp, name });
      return res.json({
        success: true,
        message: "Verification code sent to your email.",
        provider: result.provider,
      });
    } catch (deliveryError) {
      await pool.query("DELETE FROM email_verification_codes WHERE id = ?", [insertResult.insertId]);
      console.error("[send-otp] delivery failed:", deliveryError.message);
      return res.status(502).json({
        success: false,
        message: "Verification email could not be sent. Please try again later.",
      });
    }
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/auth/verify-otp-and-register
 * Validates the 6-digit OTP code atomically and provisions a verified account + session.
 */
router.post("/verify-otp-and-register", verifyOtpLimiter, async (req, res) => {
  const connection = await pool.getConnection();
  let committed = false;
  try {
    const name = requiredText(req.body.name, "name", 100);
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const organizationName = requiredText(req.body.organizationName, "organizationName", 150);
    const otp = requiredText(req.body.otp, "otp", 10);
    if (!emailPattern.test(email)) throw new Error("email must be valid.");
    if (typeof req.body.password !== "string" || req.body.password.length < 12) {
      throw new Error("password must be at least 12 characters.");
    }

    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, otp_hash, attempts_remaining
       FROM email_verification_codes
       WHERE email = ? AND purpose = 'REGISTRATION' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email],
    );
    const record = rows[0];
    if (!record) {
      throw new Error("Verification code has expired or was not requested. Please request a new code.");
    }

    if (record.attempts_remaining <= 0) {
      throw new Error("Too many failed attempts. Please request a new verification code.");
    }

    const isValid = verifyOtpHash(otp, email, record.otp_hash);
    if (!isValid) {
      await connection.query(
        "UPDATE email_verification_codes SET attempts_remaining = attempts_remaining - 1 WHERE id = ?",
        [record.id],
      );
      await connection.commit();
      committed = true;
      return res.status(400).json({
        success: false,
        message: "Invalid verification code. Please check your email and try again.",
      });
    }

    await connection.query("DELETE FROM email_verification_codes WHERE email = ?", [email]);

    const userId = `USR_${randomUUID()}`;
    const organizationId = `ORG_${randomUUID()}`;
    const passwordHash = await bcrypt.hash(req.body.password, 12);

    await connection.query(
      "INSERT INTO users (user_id, name, email, password_hash, role, email_verified, auth_provider) VALUES (?, ?, ?, ?, 'DEVELOPER', TRUE, 'LOCAL')",
      [userId, name, email, passwordHash],
    );
    await connection.query(
      "INSERT INTO organizations (organization_id, organization_name) VALUES (?, ?)",
      [organizationId, organizationName],
    );
    await connection.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'OWNER')",
      [organizationId, userId],
    );

    const refresh = await issueSession(connection, userId);
    await connection.commit();
    committed = true;

    const user = { userId, name, email };
    setRefreshCookie(res, refresh.rawToken, req);
    return res.status(201).json({
      success: true,
      accessToken: createAccessToken(user),
      user,
      organization: { organizationId, organizationName, role: "OWNER" },
    });
  } catch (error) {
    if (!committed) {
      try { await connection.rollback(); } catch {}
    }
    return res.status(error.code === "ER_DUP_ENTRY" ? 409 : 400).json({
      success: false,
      message: error.code === "ER_DUP_ENTRY" ? "An account already exists for this email." : error.message,
    });
  } finally {
    connection.release();
  }
});

/**
 * Retired unverified registration endpoint (returns 410 Gone).
 */
router.post("/register", (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "Direct registration without email verification has been retired. Use /api/auth/send-otp and /api/auth/verify-otp-and-register.",
  });
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const [users] = await pool.query(
      "SELECT user_id AS userId, name, email, password_hash AS passwordHash, email_verified AS emailVerified FROM users WHERE email = ?",
      [email],
    );
    const user = users[0];
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    }
    if (!user.emailVerified) {
      return res.status(403).json({ success: false, message: "Please verify your email address before signing in." });
    }

    const [organizations] = await pool.query(
      "SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role FROM organization_members om JOIN organizations o ON o.organization_id = om.organization_id WHERE om.user_id = ? ORDER BY o.organization_name",
      [user.userId],
    );
    const refresh = await issueSession(pool, user.userId);
    setRefreshCookie(res, refresh.rawToken, req);

    const cleanUser = { userId: user.userId, name: user.name, email: user.email };
    return res.json({
      success: true,
      accessToken: createAccessToken(cleanUser),
      user: cleanUser,
      organizations,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/refresh", refreshLimiter, async (req, res) => {
  try {
    if (!isTrustedOrigin(req)) {
      return res.status(403).json({ success: false, message: "Untrusted origin for session refresh." });
    }
    const cookies = parseCookies(req.get("cookie"));
    const result = await rotateRefreshToken(pool, cookies[REFRESH_COOKIE_NAME]);
    setRefreshCookie(res, result.rawToken, req);
    return res.json({
      success: true,
      accessToken: result.accessToken,
      user: result.user,
      organizations: result.organizations,
    });
  } catch (error) {
    if (!error.statusCode) {
      console.error("[refresh] failed:", error.message);
      return res.status(500).json({
        success: false,
        message: "Could not refresh session. Please try again.",
      });
    }
    if (error.statusCode !== 409) {
      clearRefreshCookie(res, req);
    }
    return res.status(error.statusCode).json({
      success: false,
      message: error.message || "Refresh session invalid or expired.",
    });
  }
});

router.post("/logout", async (req, res) => {
  try {
    if (!isTrustedOrigin(req)) {
      return res.status(403).json({ success: false, message: "Untrusted origin for logout." });
    }
    const cookies = parseCookies(req.get("cookie"));
    await revokeRefreshTokenFamily(pool, cookies[REFRESH_COOKIE_NAME]);
    clearRefreshCookie(res, req);
    return res.json({ success: true, message: "Signed out." });
  } catch (error) {
    clearRefreshCookie(res, req);
    return res.status(500).json({ success: false, message: error.message || "Could not sign out." });
  }
});

router.post("/logout-all", requireAuth, async (req, res) => {
  try {
    await revokeAllUserSessions(pool, req.auth.sub);
    clearRefreshCookie(res, req);
    return res.json({ success: true, message: "All active sessions signed out." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Could not revoke sessions." });
  }
});

/**
 * GET /api/auth/github
 * Initiates GitHub OAuth 2.0 flow with CSRF state cookie
 */
router.get("/github", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(400).send("GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.");
  }
  const state = issueOAuthState(res, "GITHUB", req);
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user,user:email",
    state,
  });
  return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

/**
 * GET /api/auth/github/callback
 */
router.get("/github/callback", async (req, res) => {
  const frontendUrl = getFrontendRedirectUrl();
  try {
    const cookies = parseCookies(req.get("cookie"));
    const { code, state, error: oauthError } = req.query;
    if (!verifyOAuthState(res, req, "GITHUB", state, cookies[OAUTH_STATE_COOKIE_NAME])) {
      throw new Error("OAuth state verification failed. Please try signing in again.");
    }
    if (oauthError) throw new Error(String(oauthError));
    if (!code) throw new Error("No authorization code provided by GitHub.");

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: String(code),
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    const [userRes, emailsRes] = await Promise.all([
      fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "TestOpt-Auth" },
      }),
      fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "TestOpt-Auth" },
      }),
    ]);
    const githubUser = await userRes.json();
    const emails = await emailsRes.json();
    if (!githubUser?.id || !Array.isArray(emails)) {
      throw new Error("Could not load verified identity from GitHub.");
    }
    const verifiedEmail = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
    if (!verifiedEmail?.email) {
      throw new Error("A verified email address on your GitHub account is required.");
    }

    const { user } = await handleOAuthUser({
      email: verifiedEmail.email,
      name: githubUser.name || githubUser.login,
      provider: "GITHUB",
      providerId: String(githubUser.id),
    });

    const refresh = await issueSession(pool, user.userId);
    setRefreshCookie(res, refresh.rawToken, req);
    return res.redirect(`${frontendUrl}#oauth=ok`);
  } catch (error) {
    return res.redirect(`${frontendUrl}#oauth_error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/auth/google
 * Initiates Google OAuth 2.0 flow with CSRF state cookie
 */
router.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(400).send("Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.");
  }
  const state = issueOAuthState(res, "GOOGLE", req);
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state,
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

/**
 * GET /api/auth/google/callback
 */
router.get("/google/callback", async (req, res) => {
  const frontendUrl = getFrontendRedirectUrl();
  try {
    const cookies = parseCookies(req.get("cookie"));
    const { code, state, error: oauthError } = req.query;
    if (!verifyOAuthState(res, req, "GOOGLE", state, cookies[OAUTH_STATE_COOKIE_NAME])) {
      throw new Error("OAuth state verification failed. Please try signing in again.");
    }
    if (oauthError) throw new Error(String(oauthError));
    if (!code) throw new Error("No authorization code provided by Google.");
    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: String(code),
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json();
    if (!googleUser?.id || !googleUser.email) {
      throw new Error("Could not retrieve email from Google profile.");
    }
    if (googleUser.verified_email !== true) {
      throw new Error("Your Google account email must be verified before signing in.");
    }

    const { user } = await handleOAuthUser({
      email: googleUser.email,
      name: googleUser.name,
      provider: "GOOGLE",
      providerId: String(googleUser.id),
    });

    const refresh = await issueSession(pool, user.userId);
    setRefreshCookie(res, refresh.rawToken, req);
    return res.redirect(`${frontendUrl}#oauth=ok`);
  } catch (error) {
    return res.redirect(`${frontendUrl}#oauth_error=${encodeURIComponent(error.message)}`);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const [users] = await pool.query("SELECT user_id AS userId, name, email FROM users WHERE user_id = ?", [req.auth.sub]);
  if (!users[0]) return res.status(404).json({ success: false, message: "User was not found." });
  const [organizations] = await pool.query("SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role FROM organization_members om JOIN organizations o ON o.organization_id = om.organization_id WHERE om.user_id = ? ORDER BY o.organization_name", [req.auth.sub]);
  return res.json({ success: true, user: users[0], organizations });
});

router.get("/organizations/:organizationId/members", requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params;
    await requireOrganizationRole(req.auth.sub, organizationId, ["OWNER", "ADMIN"]);
    const [members] = await pool.query(
      `SELECT u.user_id AS userId, u.name, u.email, om.role, om.created_at AS joinedAt
       FROM organization_members om
       JOIN users u ON u.user_id = om.user_id
       WHERE om.organization_id = ?
       ORDER BY u.name`,
      [organizationId],
    );
    return res.json({ success: true, members });
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message });
  }
});

router.post("/organizations/:organizationId/members", requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params;
    await requireOrganizationRole(req.auth.sub, organizationId, ["OWNER", "ADMIN"]);
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const role = (req.body.role || "DEVELOPER").toUpperCase();
    if (!VALID_ORG_ROLES.has(role)) throw new Error("Invalid organization role.");

    const [users] = await pool.query("SELECT user_id AS userId FROM users WHERE email = ?", [email]);
    if (!users[0]) return res.status(404).json({ success: false, message: "User with this email does not exist." });

    await pool.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)",
      [organizationId, users[0].userId, role],
    );
    return res.status(201).json({ success: true, member: { userId: users[0].userId, email, role } });
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message });
  }
});

router.put("/organizations/:organizationId/members/:userId", requireAuth, async (req, res) => {
  try {
    const { organizationId, userId } = req.params;
    await requireOrganizationRole(req.auth.sub, organizationId, ["OWNER", "ADMIN"]);
    const role = requiredText(req.body.role, "role", 20).toUpperCase();
    if (!VALID_ORG_ROLES.has(role)) throw new Error("Invalid organization role.");

    const [result] = await pool.query(
      "UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?",
      [role, organizationId, userId],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Member not found in organization." });

    return res.json({ success: true, member: { userId, role } });
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message });
  }
});

export default router;
