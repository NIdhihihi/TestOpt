import { generateToken, hashSecret } from '../utils/crypto.js';

const activeTokens = new Map();

export function issueSessionToken(userId, role = 'customer') {
  const rawToken = generateToken(24);
  const tokenHash = hashSecret(rawToken);
  const expiresAt = Date.now() + 3600000; // 1 hour
  activeTokens.set(tokenHash, { userId, role, expiresAt });
  return { token: rawToken, expiresAt };
}

export function validateSessionToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashSecret(rawToken);
  const session = activeTokens.get(tokenHash);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeTokens.delete(tokenHash);
    return null;
  }
  return session;
}

export function revokeSessionToken(rawToken) {
  const tokenHash = hashSecret(rawToken);
  return activeTokens.delete(tokenHash);
}

