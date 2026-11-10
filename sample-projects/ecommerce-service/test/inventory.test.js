import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAvailability, reserveStock, releaseStock } from '../src/catalog/inventory.js';

test('checkAvailability verifies warehouse quantities correctly', () => {
  const inStock = checkAvailability('sku_laptop', 2);
  assert.equal(inStock.available, true);

  const outOfStock = checkAvailability('sku_laptop', 999);
  assert.equal(outOfStock.available, false);
  assert.equal(outOfStock.reason, 'Insufficient stock');

  const unknown = checkAvailability('sku_nonexistent', 1);
  assert.equal(unknown.available, false);
});

test('reserveStock decrements available warehouse units and releaseStock restores', () => {
  const initial = checkAvailability('sku_mouse').remaining;
  const success = reserveStock('sku_mouse', 5);
  assert.equal(success, true);
  assert.equal(checkAvailability('sku_mouse').remaining, initial - 5);

  releaseStock('sku_mouse', 5);
  assert.equal(checkAvailability('sku_mouse').remaining, initial);
});

