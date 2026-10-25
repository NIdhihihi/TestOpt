import test from 'node:test';
import assert from 'node:assert/strict';
import { checkout } from './src/checkout.js';
const items = [{ sku: 'BOOK', priceCents: 2500, quantity: 2 }];
test('checkout applies a coupon and free shipping', () => {
  assert.deepEqual(checkout(items, 'SAVE10'), { subtotalCents: 5000, discountCents: 500, shippingCents: 0, totalCents: 4500, displayTotal: '$45.00' });
});
test('small orders pay the shipping fee', () => assert.equal(checkout([{ priceCents: 1000, quantity: 1 }]).totalCents, 1399));
test('empty carts total zero', () => assert.equal(checkout([]).totalCents, 0));
test('invalid quantities are rejected', () => assert.throws(() => checkout([{ priceCents: 100, quantity: 0 }]), /Quantity/));
