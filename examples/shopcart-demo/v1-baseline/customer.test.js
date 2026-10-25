import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, greeting } from './src/customer.js';
test('normalizes customer email', () => assert.equal(normalizeEmail(' Buyer@Example.com '), 'buyer@example.com'));
test('rejects invalid email', () => assert.throws(() => normalizeEmail('not-an-email'), /Invalid/));
test('greets a customer', () => assert.equal(greeting(' Sam '), 'Welcome, Sam!'));
