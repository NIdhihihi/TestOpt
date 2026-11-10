import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processPayment, verifyPaymentReceipt } from '../src/checkout/payments.js';
import { issueSessionToken } from '../src/auth/tokens.js';

test('processPayment validates active customer session and signs transaction', () => {
  const { token } = issueSessionToken('u_customer_1');
  const result = processPayment({
    userToken: token,
    amount: 149.99,
    cardLast4: '1234',
  });

  assert.equal(result.success, true);
  assert.ok(result.signature);
  assert.ok(result.receiptRef);
  assert.equal(verifyPaymentReceipt(result.transaction, result.signature), true);
});

test('processPayment rejects unauthorized or negative amounts', () => {
  const unauth = processPayment({
    userToken: 'bad_token',
    amount: 50,
  });
  assert.equal(unauth.success, false);
  assert.match(unauth.error, /Unauthorized/);

  const { token } = issueSessionToken('u_customer_2');
  const invalidAmt = processPayment({
    userToken: token,
    amount: -10,
  });
  assert.equal(invalidAmt.success, false);
});

