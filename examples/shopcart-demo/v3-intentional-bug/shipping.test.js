import test from 'node:test';
import assert from 'node:assert/strict';
import { shippingCents } from './src/shipping.js';
test('shipping is free at the threshold', () => assert.equal(shippingCents(5000), 0));
test('small orders have a fixed shipping fee', () => assert.equal(shippingCents(4999), 399));
test('empty carts have no shipping fee', () => assert.equal(shippingCents(0), 0));
