import { Router } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "../db/connection.js";
import { createAccessToken, requireAuth } from "../middleware/auth.js";
import { requireOrganizationRole } from "../middleware/authorization.js";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  sendVerificationEmail,
} from "../services/emailService.js";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ORG_ROLES = new Set(["OWNER", "ADMIN", "TEST_MANAGER", "DEVELOPER"]);

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new Error(`${name} is required and must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

/**
 * Helper to provision or link an OAuth user atomically.
 */
async function handleOAuthUser({ email, name, provider, providerId }) {
  const normalizedEmail = email.toLowerCase().trim();
  const [existing] = await pool.query(
    "SELECT user_id AS userId, name, email, role FROM users WHERE email = ?",
    [normalizedEmail]
  );

  if (existing.length > 0) {
    const user = existing[0];
    await pool.query(
      "UPDATE users SET email_verified = TRUE, auth_provider = ?, auth_provider_id = ? WHERE user_id = ?",
      [provider, providerId, user.userId]
    );
    const [organizations] = await pool.query(
      "SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role FROM organization_members om JOIN organizations o ON o.organization_id = om.organization_id WHERE om.user_id = ? ORDER BY o.organization_name",
      [user.userId]
    );
    return { user, organizations, isNew: false };
  }

  const connection = await pool.getConnection();
  try {
    const userId = `USR_${randomUUID()}`;
    const organizationId = `ORG_${randomUUID()}`;
    const organizationName = `${name || "Engineering"} Workspace`;

    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO users (user_id, name, email, password_hash, role, email_verified, auth_provider, auth_provider_id) VALUES (?, ?, ?, NULL, 'DEVELOPER', TRUE, ?, ?)",
      [userId, name || "User", normalizedEmail, provider, providerId]
    );
    await connection.query(
      "INSERT INTO organizations (organization_id, organization_name) VALUES (?, ?)",
      [organizationId, organizationName]
    );
    await connection.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'OWNER')",
      [organizationId, userId]
    );
    await connection.commit();

    const user = { userId, name: name || "User", email: normalizedEmail };
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
router.post("/send-otp", async (req, res) => {
  try {
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "there";
    if (!emailPattern.test(email)) throw new Error("email must be valid.");

    // Check if user is already registered
    const [existing] = await pool.query("SELECT user_id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: "An account already exists for this email. Please sign in." });
    }

    // Rate limiting: 60s cooldown per email address
    const [recent] = await pool.query(
      "SELECT id FROM email_verification_codes WHERE email = ? AND created_at > NOW() - INTERVAL 60 SECOND ORDER BY created_at DESC LIMIT 1",
      [email]
    );
    if (recent.length > 0) {
      return res.status(429).json({ success: false, message: "Please wait 60 seconds before requesting another code." });
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp, email);

    // Invalidate earlier codes for this email
    await pool.query("DELETE FROM email_verification_codes WHERE email = ?", [email]);

    // Save with 10-minute expiry
    await pool.query(
      "INSERT INTO email_verification_codes (email, otp_hash, purpose, expires_at) VALUES (?, ?, 'REGISTRATION', NOW() + INTERVAL 10 MINUTE)",
      [email, otpHash]
    );

    const result = await sendVerificationEmail({ email, otp, name });

    return res.json({
      success: true,
      message: "Verification code sent to your email.",
      provider: result.provider,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/auth/verify-otp-and-register
 * Validates the 6-digit OTP code and provisions a verified account.
 */
router.post("/verify-otp-and-register", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const name = requiredText(req.body.name, "name", 100);
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const organizationName = requiredText(req.body.organizationName, "organizationName", 150);
    const otp = requiredText(req.body.otp, "otp", 10);
    if (!emailPattern.test(email)) throw new Error("email must be valid.");
    if (typeof req.body.password !== "string" || req.body.password.length < 12) {
      throw new Error("password must be at least 12 characters.");
    }

    // Verify OTP against stored active records
    const [rows] = await connection.query(
      "SELECT id, otp_hash, attempts_remaining, expires_at FROM email_verification_codes WHERE email = ? AND purpose = 'REGISTRATION' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1",
      [email]
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
        [record.id]
      );
      throw new Error("Invalid verification code. Please check your email and try again.");
    }

    // Delete used OTP
    await connection.query("DELETE FROM email_verification_codes WHERE email = ?", [email]);

    const userId = `USR_${randomUUID()}`;
    const organizationId = `ORG_${randomUUID()}`;
    const passwordHash = await bcrypt.hash(req.body.password, 12);

    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO users (user_id, name, email, password_hash, role, email_verified, auth_provider) VALUES (?, ?, ?, ?, 'DEVELOPER', TRUE, 'LOCAL')",
      [userId, name, email, passwordHash]
    );
    await connection.query(
      "INSERT INTO organizations (organization_id, organization_name) VALUES (?, ?)",
      [organizationId, organizationName]
    );
    await connection.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'OWNER')",
      [organizationId, userId]
    );
    await connection.commit();

    const user = { userId, name, email };
    return res.status(201).json({
      success: true,
      accessToken: createAccessToken(user),
      user,
      organization: { organizationId, organizationName, role: "OWNER" },
    });
  } catch (error) {
    await connection.rollback();
    return res.status(error.code === "ER_DUP_ENTRY" ? 409 : 400).json({
      success: false,
      message: error.code === "ER_DUP_ENTRY" ? "An account already exists for this email." : error.message,
    });
  } finally {
    connection.release();
  }
});

/**
 * Standard legacy registration endpoint (retained for backward compatibility and test suites)
 */
router.post("/register", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const name = requiredText(req.body.name, "name", 100);
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const organizationName = requiredText(req.body.organizationName, "organizationName", 150);
    if (!emailPattern.test(email)) throw new Error("email must be valid.");
    if (typeof req.body.password !== "string" || req.body.password.length < 12) throw new Error("password must be at least 12 characters.");
    const userId = `USR_${randomUUID()}`;
    const organizationId = `ORG_${randomUUID()}`;
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await connection.beginTransaction();
    await connection.query(
      "INSERT INTO users (user_id, name, email, password_hash, role, email_verified, auth_provider) VALUES (?, ?, ?, ?, 'DEVELOPER', TRUE, 'LOCAL')",
      [userId, name, email, passwordHash]
    );
    await connection.query("INSERT INTO organizations (organization_id, organization_name) VALUES (?, ?)", [organizationId, organizationName]);
    await connection.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'OWNER')", [organizationId, userId]);
    await connection.commit();
    const user = { userId, name, email };
    return res.status(201).json({ success: true, accessToken: createAccessToken(user), user, organization: { organizationId, organizationName, role: "OWNER" } });
  } catch (error) {
    await connection.rollback();
    return res.status(error.code === "ER_DUP_ENTRY" ? 409 : 400).json({ success: false, message: error.code === "ER_DUP_ENTRY" ? "An account already exists for this email." : error.message });
  } finally { connection.release(); }
});

router.post("/login", async (req, res) => {
  try {
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const [users] = await pool.query("SELECT user_id AS userId, name, email, password_hash AS passwordHash FROM users WHERE email = ?", [email]);
    const user = users[0];
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    }
    const [organizations] = await pool.query("SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role FROM organization_members om JOIN organizations o ON o.organization_id = om.organization_id WHERE om.user_id = ? ORDER BY o.organization_name", [user.userId]);
    return res.json({ success: true, accessToken: createAccessToken(user), user: { userId: user.userId, name: user.name, email: user.email }, organizations });
  } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
});

/**
 * GET /api/auth/github
 * Initiates GitHub OAuth 2.0 flow
 */
router.get("/github", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(400).send("GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.");
  }
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email`;
  res.redirect(url);
});

/**
 * GET /api/auth/github/callback
 */
router.get("/github/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  try {
    const { code } = req.query;
    if (!code) throw new Error("No authorization code provided by GitHub.");

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "TestOpt-Auth" },
    });
    const githubUser = await userRes.json();

    let email = githubUser.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "TestOpt-Auth" },
      });
      const emails = await emailsRes.json();
      const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
      email = primary?.email;
    }

    if (!email) throw new Error("Could not retrieve a verified email address from your GitHub profile.");

    const { user, organizations } = await handleOAuthUser({
      email,
      name: githubUser.name || githubUser.login,
      provider: "GITHUB",
      providerId: String(githubUser.id),
    });

    const accessToken = createAccessToken(user);
    const sessionPayload = encodeURIComponent(JSON.stringify({ accessToken, user, organizations }));
    return res.redirect(`${frontendUrl}#oauth_session=${sessionPayload}`);
  } catch (error) {
    return res.redirect(`${frontendUrl}#oauth_error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/auth/google
 * Initiates Google OAuth 2.0 flow
 */
router.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(400).send("Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.");
  }
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&prompt=select_account`;
  res.redirect(url);
});

/**
 * GET /api/auth/google/callback
 */
router.get("/google/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  try {
    const { code } = req.query;
    if (!code) throw new Error("No authorization code provided by Google.");
    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
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
    if (!googleUser.email) throw new Error("Could not retrieve email from Google profile.");

    const { user, organizations } = await handleOAuthUser({
      email: googleUser.email,
      name: googleUser.name,
      provider: "GOOGLE",
      providerId: String(googleUser.id),
    });

    const accessToken = createAccessToken(user);
    const sessionPayload = encodeURIComponent(JSON.stringify({ accessToken, user, organizations }));
    return res.redirect(`${frontendUrl}#oauth_session=${sessionPayload}`);
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
      [organizationId]
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
      [organizationId, users[0].userId, role]
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
      [role, organizationId, userId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Member not found in organization." });

    return res.json({ success: true, member: { userId, role } });
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message });
  }
});

export default router;
