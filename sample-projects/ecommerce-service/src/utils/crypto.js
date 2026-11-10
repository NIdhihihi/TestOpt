import crypto from 'node:crypto';

export function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

export function signPayload(payload, key) {
  const serialized = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', key).update(serialized).digest('hex');
  return { payload, signature };
}

export function verifySignature(payload, signature, key) {
  const expected = crypto.createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
  return expected === signature;
}

