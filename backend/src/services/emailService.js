import { randomInt, createHash, timingSafeEqual } from 'node:crypto';

let verificationEmailSink = null;

/**
 * Registers an in-process mail sink for automated test suites so OTP flows can
 * be exercised end-to-end without exposing OTPs over HTTP or bypassing verification.
 */
export function setVerificationEmailSink(sink) {
  verificationEmailSink = typeof sink === 'function' ? sink : null;
}

function getOtpSecret() {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('OTP_SECRET or JWT_SECRET must be set to a random value of at least 32 characters.');
  }
  return secret;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 */
export function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

/**
 * Hashes an OTP for secure persistence at rest.
 */
export function hashOtp(otp, email) {
  return createHash('sha256')
    .update(`${String(email).toLowerCase().trim()}:${String(otp)}:${getOtpSecret()}`)
    .digest('hex');
}

/**
 * Constant-time comparison between a submitted OTP and its stored SHA-256 hash.
 */
export function verifyOtpHash(otp, email, storedHash) {
  if (typeof otp !== 'string' || typeof storedHash !== 'string') return false;
  const calculated = Buffer.from(hashOtp(otp, email), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  if (calculated.length !== expected.length) return false;
  return timingSafeEqual(calculated, expected);
}

function renderVerificationEmail(otp, name = 'there') {
  const safeName = escapeHtml(name);
  const safeOtp = escapeHtml(otp);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your TestOpt Verification Code</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #070b16; color: #e6edf7; }
    .container { max-width: 540px; margin: 40px auto; background-color: #0d1424; border: 1px solid #1e293b; border-radius: 12px; padding: 36px 32px; }
    .kicker { font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #8b9ab3; margin-bottom: 8px; }
    h1 { font-size: 22px; margin: 0 0 14px; color: #f8fafc; }
    p { font-size: 14px; line-height: 1.6; color: #8b9ab3; margin: 0 0 20px; }
    .code-box { background: #060913; border: 1px solid #38bdf844; border-radius: 10px; padding: 18px; text-align: center; margin: 26px 0; }
    .otp { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #38bdf8; }
    .footer { font-size: 11px; color: #64748b; line-height: 1.5; border-top: 1px solid #1e293b; padding-top: 18px; margin-top: 26px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="kicker">REGRESSION TEST SELECTION &amp; SCHEDULING</div>
    <h1>Verify your TestOpt account</h1>
    <p>Hi ${safeName},</p>
    <p>Please enter the following 6-digit verification code to complete your TestOpt registration and access your workspace:</p>
    <div class="code-box">
      <div class="otp">${safeOtp}</div>
    </div>
    <p>This code will expire in <strong>10 minutes</strong>. If you did not request this email, you can safely ignore it.</p>
    <div class="footer">
      TestOpt Change-Aware Regression Testing Platform · Automated Security Notification
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Dispatches an OTP verification email via Resend, SendGrid, an in-process test sink,
 * or non-production terminal fallback. Fails closed in production when no provider succeeds.
 */
export async function sendVerificationEmail({ email, otp, name = 'there' }) {
  const normalizedEmail = email.toLowerCase().trim();
  const subject = `Your TestOpt Verification Code`;
  const html = renderVerificationEmail(otp, name);

  if (verificationEmailSink) {
    await verificationEmailSink({ email: normalizedEmail, otp, name, subject, html });
    return { delivered: true, provider: 'test-sink' };
  }

  const isProd = process.env.NODE_ENV === 'production';

  if (process.env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'TestOpt <onboarding@resend.dev>',
        to: [normalizedEmail],
        subject: `${subject}: ${otp}`,
        html,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to send verification email via Resend.');
    }
    return { delivered: true, provider: 'resend', id: data.id };
  }

  if (process.env.SENDGRID_API_KEY) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: normalizedEmail }] }],
        from: { email: process.env.EMAIL_FROM || 'security@testopt.dev', name: 'TestOpt' },
        subject: `${subject}: ${otp}`,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SendGrid responded with status ${response.status}: ${errorText}`);
    }
    return { delivered: true, provider: 'sendgrid' };
  }

  if (isProd) {
    throw new Error('Email delivery provider is not configured for production.');
  }

  console.log('\n======================================================');
  console.log(' [TestOpt Auth] Development Verification Code');
  console.log(` To:      ${normalizedEmail}`);
  console.log(` Code:    ${otp}`);
  console.log(' Validity: 10 minutes');
  console.log(' (Configure RESEND_API_KEY or SENDGRID_API_KEY in .env for external delivery)');
  console.log('======================================================\n');

  return { delivered: true, provider: 'dev-console' };
}
