import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSubtotal, applyCouponDiscount, calculateTax, computeTotalOrderPrice } from '../src/catalog/pricing.js';

test('calculateSubtotal sums line items accurately', () => {
  const items = [
    { id: 'sku_1', price: 19.99, quantity: 2 },
    { id: 'sku_2', price: 10.00, quantity: 1 },
  ];
  const subtotal = calculateSubtotal(items);
  assert.equal(subtotal, 49.98);
});

test('applyCouponDiscount applies percentage and threshold coupons', () => {
  const { discount, finalSubtotal } = applyCouponDiscount(100, 'SAVE25');
  assert.equal(discount, 25);
  assert.equal(finalSubtotal, 75);

  const flat = applyCouponDiscount(40, 'FLAT15');
  assert.equal(flat.discount, 15);
  assert.equal(flat.finalSubtotal, 25);

  const invalid = applyCouponDiscount(20, 'SAVE25');
  assert.equal(invalid.discount, 0);
});

test('computeTotalOrderPrice computes subtotal, discount, regional tax, and total', () => {
  const items = [{ price: 50, quantity: 2 }]; // 100
  const breakdown = computeTotalOrderPrice(items, 'SAVE10', 'US_CA');
  assert.equal(breakdown.subtotal, 100);
  assert.equal(breakdown.discount, 10);
  assert.equal(breakdown.tax, 7.43); // 90 * 0.0825
  assert.equal(breakdown.total, 97.43);
});

