import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createAccessToken, getJwtSecret } from "../middleware/auth.js";

export const REFRESH_COOKIE_NAME = "testopt_refresh";
export const OAUTH_STATE_COOKIE_NAME = "testopt_oauth_state";
const DAY_MS = 24 * 60 * 60 * 1000;

export function getAllowedOrigins() {
  return (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getRefreshTtlDays() {
  const value = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7);
  if (!Number.isFinite(value) || value < 1 || value > 30) return 7;
  return Math.floor(value);
}

export function getMaxSessionDays() {
  const ttl = getRefreshTtlDays();
  const value = Number(process.env.REFRESH_MAX_SESSION_DAYS || 30);
  if (!Number.isFinite(value) || value < ttl) return Math.max(30, ttl);
  return Math.min(365, Math.floor(value));
}

export function getRefreshRotationGraceMs() {
  const raw = process.env.REFRESH_ROTATION_GRACE_MS;
  if (raw === undefined || raw === "") return 10_000;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 60_000) : 10_000;
}

export function getCookieSameSite() {
  const raw = (process.env.COOKIE_SAME_SITE || "lax").trim().toLowerCase();
  return ["lax", "strict", "none"].includes(raw) ? raw : "lax";
}

export function isCookieSecure(req) {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  if (getCookieSameSite() === "none") return true;
  return process.env.NODE_ENV === "production" || Boolean(req?.secure);
}

function hashToken(rawToken) {
  return createHash("sha256").update(String(rawToken)).digest("hex");
}

function cookieBaseOptions(req) {
  return {
    httpOnly: true,
    sameSite: getCookieSameSite(),
    secure: isCookieSecure(req),
    path: "/api/auth",
  };
}

export function setRefreshCookie(res, rawToken, req) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    ...cookieBaseOptions(req),
    maxAge: getRefreshTtlDays() * DAY_MS,
  });
}

export function clearRefreshCookie(res, req) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieBaseOptions(req));
}

function signOAuthState(nonce, provider) {
  return createHmac("sha256", getJwtSecret())
    .update(`${provider}:${nonce}`)
    .digest("hex");
}

/**
 * Generates an OAuth CSRF state token and binds it to an HttpOnly cookie for the given provider.
 */
export function issueOAuthState(res, provider, req) {
  const nonce = randomBytes(24).toString("base64url");
  const signature = signOAuthState(nonce, provider);
  res.cookie(OAUTH_STATE_COOKIE_NAME, signature, {
    httpOnly: true,
    sameSite: "lax",
    secure: isCookieSecure(req),
    path: "/api/auth",
    maxAge: 10 * 60 * 1000,
  });
  return nonce;
}

/**
 * Validates and clears the OAuth CSRF state cookie using constant-time comparison.
 */
export function verifyOAuthState(res, req, provider, queryState, cookieDigest) {
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isCookieSecure(req),
    path: "/api/auth",
  });
  if (typeof queryState !== "string" || !queryState || typeof cookieDigest !== "string" || !cookieDigest) {
    return false;
  }
  const expected = Buffer.from(signOAuthState(queryState, provider), "utf8");
  const actual = Buffer.from(cookieDigest, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Checks whether browser-supplied Origin/Referer headers match the allowlisted origins.
 */
export function isTrustedOrigin(req) {
  const allowed = getAllowedOrigins();
  const origin = req.get("origin");
  if (origin) return allowed.includes(origin);
  const referer = req.get("referer");
  if (!referer) return true;
  try {
    return allowed.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

/**
 * Creates a new refresh-token family for an authenticated user.
 */
export async function issueSession(connOrPool, userId, now = Date.now()) {
  const tokenId = `RT_${randomUUID()}`;
  const familyId = `FAM_${randomUUID()}`;
  const rawToken = randomBytes(48).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(now + getRefreshTtlDays() * DAY_MS);
  const maxExpiresAt = new Date(now + getMaxSessionDays() * DAY_MS);

  await connOrPool.query(
    `INSERT INTO refresh_tokens (token_id, user_id, family_id, token_hash, expires_at, max_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, familyId, tokenHash, expiresAt, maxExpiresAt],
  );

  return { tokenId, familyId, rawToken, expiresAt, maxExpiresAt };
}

async function fetchUserOrganizations(conn, userId) {
  const [organizations] = await conn.query(
    `SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role
     FROM organization_members om
     JOIN organizations o ON o.organization_id = om.organization_id
     WHERE om.user_id = ?
     ORDER BY o.organization_name`,
    [userId],
  );
  return organizations;
}

/**
 * Rotates a refresh token inside a transaction with reuse detection across the entire family.
 */
export async function rotateRefreshToken(pool, rawToken, now = Date.now()) {
  if (typeof rawToken !== "string" || !rawToken) {
    throw Object.assign(new Error("Refresh token is missing."), { statusCode: 401 });
  }

  const conn = await pool.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();
    const tokenHash = hashToken(rawToken);
    const [rows] = await conn.query(
      "SELECT * FROM refresh_tokens WHERE token_hash = ? FOR UPDATE",
      [tokenHash],
    );
    const row = rows[0];
    if (!row) {
      await conn.rollback();
      throw Object.assign(new Error("Invalid refresh session."), { statusCode: 401 });
    }

    const nowDate = new Date(now);
    if (row.revoked_at !== null) {
      const graceMs = getRefreshRotationGraceMs();
      const revokedAgeMs = now - new Date(row.revoked_at).getTime();
      if (row.replaced_by_id && graceMs > 0 && revokedAgeMs >= 0 && revokedAgeMs < graceMs) {
        await conn.rollback();
        committed = true;
        throw Object.assign(new Error("Refresh already rotated; retry with the latest session."), { statusCode: 409 });
      }
      // Replay of a rotated or revoked refresh token outside the concurrency grace window indicates reuse.
      await conn.query(
        "UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL",
        [nowDate, row.family_id],
      );
      await conn.commit();
      committed = true;
      throw Object.assign(new Error("Refresh session revoked due to token reuse."), { statusCode: 401 });
    }

    if (new Date(row.expires_at) <= nowDate || new Date(row.max_expires_at) <= nowDate) {
      await conn.query("UPDATE refresh_tokens SET revoked_at = ? WHERE token_id = ?", [nowDate, row.token_id]);
      await conn.commit();
      committed = true;
      throw Object.assign(new Error("Refresh session expired. Please sign in again."), { statusCode: 401 });
    }

    const [users] = await conn.query(
      "SELECT user_id AS userId, name, email, email_verified AS emailVerified FROM users WHERE user_id = ?",
      [row.user_id],
    );
    const user = users[0];
    if (!user || !user.emailVerified) {
      await conn.query(
        "UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL",
        [nowDate, row.family_id],
      );
      await conn.commit();
      committed = true;
      throw Object.assign(new Error("Account is unavailable or unverified."), { statusCode: 401 });
    }

    const newTokenId = `RT_${randomUUID()}`;
    const newRawToken = randomBytes(48).toString("base64url");
    const newTokenHash = hashToken(newRawToken);
    const candidateExpiry = now + getRefreshTtlDays() * DAY_MS;
    const hardCap = new Date(row.max_expires_at).getTime();
    const nextExpiresAt = new Date(Math.min(candidateExpiry, hardCap));

    await conn.query(
      "UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ? WHERE token_id = ?",
      [nowDate, newTokenId, row.token_id],
    );
    await conn.query(
      `INSERT INTO refresh_tokens (token_id, user_id, family_id, token_hash, expires_at, max_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newTokenId, row.user_id, row.family_id, newTokenHash, nextExpiresAt, new Date(row.max_expires_at)],
    );

    const organizations = await fetchUserOrganizations(conn, user.userId);
    await conn.commit();
    committed = true;

    const cleanUser = { userId: user.userId, name: user.name, email: user.email };
    return {
      accessToken: createAccessToken(cleanUser),
      rawToken: newRawToken,
      expiresAt: nextExpiresAt,
      user: cleanUser,
      organizations,
    };
  } catch (error) {
    if (!committed) {
      try { await conn.rollback(); } catch {}
    }
    throw error;
  } finally {
    conn.release();
  }
}

export async function revokeRefreshTokenFamily(pool, rawToken) {
  if (typeof rawToken !== "string" || !rawToken) return;
  const tokenHash = hashToken(rawToken);
  const [rows] = await pool.query("SELECT family_id FROM refresh_tokens WHERE token_hash = ?", [tokenHash]);
  if (rows[0]?.family_id) {
    await pool.query(
      "UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL",
      [rows[0].family_id],
    );
  }
}

export async function revokeAllUserSessions(pool, userId) {
  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
    [userId],
  );
}
