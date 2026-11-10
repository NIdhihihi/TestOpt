import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSessionToken, validateSessionToken, revokeSessionToken } from '../src/auth/tokens.js';

test('issueSessionToken issues verifiable bearer tokens', () => {
  const { token, expiresAt } = issueSessionToken('usr_99', 'merchant');
  assert.ok(token);
  assert.ok(expiresAt > Date.now());

  const session = validateSessionToken(token);
  assert.equal(session.userId, 'usr_99');
  assert.equal(session.role, 'merchant');
});

test('validateSessionToken rejects invalid or revoked tokens', () => {
  const { token } = issueSessionToken('usr_100');
  assert.ok(validateSessionToken(token));
  revokeSessionToken(token);
  assert.equal(validateSessionToken(token), null);
  assert.equal(validateSessionToken('completely-fake-token'), null);
});

