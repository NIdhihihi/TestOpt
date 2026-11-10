import test from "node:test";
import assert from "node:assert/strict";
import { parseCookies } from "../middleware/auth.js";
import {
  generateOtp,
  hashOtp,
  sendVerificationEmail,
  setVerificationEmailSink,
  verifyOtpHash,
} from "./emailService.js";
import {
  OAUTH_STATE_COOKIE_NAME,
  issueOAuthState,
  rotateRefreshToken,
  verifyOAuthState,
} from "./sessionService.js";
import { loadShopcartDemoPackage } from "./demoLoaderService.js";

test("OTP hashing fails closed without strong secret and escapes HTML email name", async () => {
  const prevOtpSecret = process.env.OTP_SECRET;
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevResend = process.env.RESEND_API_KEY;
  const prevSendgrid = process.env.SENDGRID_API_KEY;
  try {
    delete process.env.OTP_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    assert.throws(() => hashOtp("123456", "a@example.com"), /at least 32 characters/);

    process.env.JWT_SECRET = "too-short";
    assert.throws(() => hashOtp("123456", "a@example.com"), /at least 32 characters/);

    process.env.OTP_SECRET = "strong-test-otp-secret-at-least-thirty-two-chars";
    const otp = generateOtp();
    assert.match(otp, /^\d{6}$/);
    const digest = hashOtp(otp, "Alice@Example.com");
    assert.equal(verifyOtpHash(otp, "alice@example.com", digest), true);
    assert.equal(verifyOtpHash("000000", "alice@example.com", digest), false);

    let captured = null;
    setVerificationEmailSink((mail) => {
      captured = mail;
    });
    const res = await sendVerificationEmail({
      email: "alice@example.com",
      otp,
      name: '<script>alert("xss")</script>',
    });
    assert.equal(res.provider, "test-sink");
    assert.equal("otp" in res, false);
    assert.ok(captured.html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"));
    assert.equal(captured.html.includes("<script>"), false);

    setVerificationEmailSink(null);
    process.env.NODE_ENV = "production";
    await assert.rejects(
      sendVerificationEmail({ email: "alice@example.com", otp, name: "Alice" }),
      /not configured for production/,
    );
  } finally {
    setVerificationEmailSink(null);
    if (prevOtpSecret === undefined) delete process.env.OTP_SECRET;
    else process.env.OTP_SECRET = prevOtpSecret;
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResend;
    if (prevSendgrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = prevSendgrid;
  }
});

test("parseCookies and OAuth state verification reject tampered or cross-provider tokens", () => {
  const prevJwtSecret = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = "strong-test-jwt-secret-at-least-thirty-two-chars";
    const parsed = parseCookies("foo=bar; testopt_oauth_state=abc%3D123; empty=");
    assert.equal(parsed.foo, "bar");
    assert.equal(parsed.testopt_oauth_state, "abc=123");

    const cookiesSet = {};
    const cleared = [];
    const fakeRes = {
      cookie(name, val) {
        cookiesSet[name] = val;
      },
      clearCookie(name) {
        cleared.push(name);
      },
    };
    const fakeReq = { secure: false };
    const nonce = issueOAuthState(fakeRes, "GITHUB", fakeReq);
    const digest = cookiesSet[OAUTH_STATE_COOKIE_NAME];
    assert.ok(nonce && digest);

    assert.equal(verifyOAuthState(fakeRes, fakeReq, "GOOGLE", nonce, digest), false);
    assert.equal(verifyOAuthState(fakeRes, fakeReq, "GITHUB", "wrong-nonce", digest), false);
    assert.equal(verifyOAuthState(fakeRes, fakeReq, "GITHUB", nonce, digest), true);
    assert.ok(cleared.includes(OAUTH_STATE_COOKIE_NAME));
  } finally {
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test("rotateRefreshToken rotates tokens and revokes entire family on reuse", async () => {
  const prevJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "strong-test-jwt-secret-at-least-thirty-two-chars";
  try {
    const tokens = new Map([
      [
        "hash_initial",
        {
          token_id: "RT_1",
          user_id: "USR_1",
          family_id: "FAM_1",
          token_hash: "hash_initial",
          expires_at: new Date(Date.now() + 3600_000),
          max_expires_at: new Date(Date.now() + 7 * 86400_000),
          revoked_at: null,
          replaced_by_id: null,
        },
      ],
    ]);
    const familyRevocations = [];

    const fakeConn = {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async query(sql, params) {
        if (sql.includes("FROM refresh_tokens WHERE token_hash = ? FOR UPDATE")) {
          const row = [...tokens.values()].find((r) => r.token_hash === params[0]);
          return [row ? [row] : []];
        }
        if (sql.includes("UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ?")) {
          familyRevocations.push(params[1]);
          for (const row of tokens.values()) {
            if (row.family_id === params[1] && row.revoked_at === null) row.revoked_at = params[0];
          }
          return [{}];
        }
        if (sql.includes("UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ?")) {
          for (const row of tokens.values()) {
            if (row.token_id === params[2]) {
              row.revoked_at = params[0];
              row.replaced_by_id = params[1];
            }
          }
          return [{}];
        }
        if (sql.includes("INSERT INTO refresh_tokens")) {
          tokens.set(params[3], {
            token_id: params[0],
            user_id: params[1],
            family_id: params[2],
            token_hash: params[3],
            expires_at: params[4],
            max_expires_at: params[5],
            revoked_at: null,
            replaced_by_id: null,
          });
          return [{}];
        }
        if (sql.includes("FROM users WHERE user_id = ?")) {
          return [[{ userId: "USR_1", name: "Alice", email: "alice@example.com", emailVerified: 1 }]];
        }
        if (sql.includes("FROM organization_members")) {
          return [[{ organizationId: "ORG_1", organizationName: "Alice Org", role: "OWNER" }]];
        }
        return [[]];
      },
    };
    const fakePool = { async getConnection() { return fakeConn; } };

    // Within concurrent grace window (< 10s), rotated token returns 409 without revoking family
    const { createHash } = await import("node:crypto");
    const raw = "test-raw-token";
    const hash = createHash("sha256").update(raw).digest("hex");
    const revokedAt = new Date(Date.now() - 2000);
    tokens.set(hash, {
      token_id: "RT_REVOKED",
      user_id: "USR_1",
      family_id: "FAM_1",
      token_hash: hash,
      expires_at: new Date(Date.now() + 3600_000),
      max_expires_at: new Date(Date.now() + 7 * 86400_000),
      revoked_at: revokedAt,
      replaced_by_id: "RT_2",
    });
    tokens.set("hash_active_child", {
      token_id: "RT_2",
      user_id: "USR_1",
      family_id: "FAM_1",
      token_hash: "hash_active_child",
      expires_at: new Date(Date.now() + 3600_000),
      max_expires_at: new Date(Date.now() + 7 * 86400_000),
      revoked_at: null,
      replaced_by_id: null,
    });

    await assert.rejects(
      () => rotateRefreshToken(fakePool, raw),
      (err) => err.statusCode === 409,
    );
    assert.deepEqual(familyRevocations, []);
    assert.equal(tokens.get("hash_active_child").revoked_at, null);

    // Sub-second forward rounding or skew (< 1s) within grace still resolves as non-destructive 409
    tokens.get(hash).revoked_at = new Date(Date.now() + 400);
    await assert.rejects(
      () => rotateRefreshToken(fakePool, raw),
      (err) => err.statusCode === 409,
    );
    assert.deepEqual(familyRevocations, []);
    assert.equal(tokens.get("hash_active_child").revoked_at, null);

    // Outside concurrent grace window (> 10s), replay triggers reuse detection and revokes entire family
    tokens.get(hash).revoked_at = new Date(Date.now() - 20_000);
    await assert.rejects(
      () => rotateRefreshToken(fakePool, raw),
      (err) => err.statusCode === 401 && /revoked due to token reuse/.test(err.message),
    );
    assert.deepEqual(familyRevocations, ["FAM_1"]);
    assert.notEqual(tokens.get("hash_active_child").revoked_at, null);
  } finally {
    if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwtSecret;
  }
});

test("loadShopcartDemoPackage validates ShopCart baseline cleanly", async () => {
  const pkg = await loadShopcartDemoPackage();
  assert.equal(pkg.analysis.supported, true);
  assert.equal(pkg.analysis.tests.length, 6);
  assert.ok(pkg.files.some((file) => file.path === "package.json"));
});

