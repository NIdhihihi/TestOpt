import test from 'node:test';
import assert from 'node:assert/strict';
import { discountCents } from './src/discounts.js';
test('SAVE10 discounts an order by ten percent', () => assert.equal(discountCents(2000, 'SAVE10'), 200));
test('coupon input ignores case and surrounding spaces', () => assert.equal(discountCents(2000, ' save10 '), 200));
test('SAVE5 discounts an order by five percent', () => assert.equal(discountCents(2000, 'SAVE5'), 100));
test('unknown coupons produce no discount', () => assert.equal(discountCents(2000, 'UNKNOWN'), 0));
test('discount rounds to whole cents', () => assert.equal(discountCents(999, 'SAVE10'), 100));
test('negative amounts are rejected', () => assert.throws(() => discountCents(-1, 'SAVE10'), /non-negative/));
