import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShoppingCart } from '../src/cart/cart.js';

test('ShoppingCart adds items and computes checkout breakdown', () => {
  const cart = new ShoppingCart('u_alice', 'US_CA');
  cart.addItem('sku_laptop', 'Pro Laptop', 1000, 1);
  cart.applyCoupon('SAVE10');

  const summary = cart.getCheckoutSummary();
  assert.equal(summary.subtotal, 1000);
  assert.equal(summary.discount, 100);
  assert.ok(summary.total > 900);
});

test('ShoppingCart prevents adding items that exceed inventory', () => {
  const cart = new ShoppingCart('u_alice');
  assert.throws(() => {
    cart.addItem('sku_laptop', 'Pro Laptop', 1000, 9999);
  }, /Insufficient stock/);
});

test('ShoppingCart allows removing items', () => {
  const cart = new ShoppingCart('u_bob');
  cart.addItem('sku_mouse', 'Mouse', 25, 2);
  assert.equal(cart.items.length, 1);
  cart.removeItem('sku_mouse');
  assert.equal(cart.items.length, 0);
});

