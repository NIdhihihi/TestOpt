import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, generateToken, signPayload, verifySignature } from '../src/utils/crypto.js';

test('hashSecret creates deterministic sha256 output', () => {
  const hash1 = hashSecret('password123');
  const hash2 = hashSecret('password123');
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
});

test('generateToken produces hex tokens of requested byte length', () => {
  const token = generateToken(16);
  assert.equal(typeof token, 'string');
  assert.equal(token.length, 32);
});

test('signPayload and verifySignature validate genuine signatures', () => {
  const key = 'secret-service-key';
  const data = { userId: 'u_101', role: 'admin' };
  const { signature } = signPayload(data, key);
  assert.equal(verifySignature(data, signature, key), true);
  assert.equal(verifySignature(data, 'tampered-signature', key), false);
});

