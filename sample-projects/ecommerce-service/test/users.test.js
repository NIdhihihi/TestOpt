import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateUser, getUserById } from '../src/auth/users.js';

test('authenticateUser logs in valid credentials and issues session token', () => {
  const result = authenticateUser('alice@example.com', 'alicePass1');
  assert.equal(result.success, true);
  assert.equal(result.user.email, 'alice@example.com');
  assert.ok(result.session.token);
});

test('authenticateUser rejects incorrect passwords or unknown emails', () => {
  const wrongPass = authenticateUser('alice@example.com', 'wrongPassword');
  assert.equal(wrongPass.success, false);
  assert.equal(wrongPass.error, 'Invalid password');

  const unknown = authenticateUser('nonexistent@example.com', 'password');
  assert.equal(unknown.success, false);
});

test('getUserById retrieves customer profiles by ID', () => {
  const user = getUserById('u_alice');
  assert.ok(user);
  assert.equal(user.email, 'alice@example.com');
  assert.equal(getUserById('u_nonexistent'), null);
});

