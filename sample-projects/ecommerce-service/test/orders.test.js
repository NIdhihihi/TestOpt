import test from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder } from '../src/checkout/orders.js';
import { ShoppingCart } from '../src/cart/cart.js';
import { authenticateUser } from '../src/auth/users.js';
import { restockItem } from '../src/catalog/inventory.js';

test('orders - placeOrder validation and execution', async (t) => {
  await t.test('rejects checkout with empty cart', () => {
    const cart = new ShoppingCart('usr_test_1');
    const result = placeOrder({ cart, userToken: 'tok_mock' });
    assert.strictEqual(result.success, false);
    assert.match(result.error, /empty cart/i);
  });

  await t.test('rejects checkout for non-existent user', () => {
    restockItem('PROD-100', 50);
    const cart = new ShoppingCart('usr_unknown_999');
    cart.addItem('PROD-100', 'Widget', 20, 1);
    const result = placeOrder({ cart, userToken: 'tok_mock' });
    assert.strictEqual(result.success, false);
    assert.match(result.error, /User account could not be found/i);
  });

  await t.test('rejects checkout when inventory is depleted', () => {
    const auth = authenticateUser('alice@example.com', 'alicePass1');

    restockItem('LIMITED-EDITION', 1);
    const cart = new ShoppingCart(auth.user.id);
    cart.addItem('LIMITED-EDITION', 'Rare Antique', 999, 1);

    // Simulate inventory becoming 0
    restockItem('LIMITED-EDITION', 0);

    const result = placeOrder({ cart, userToken: auth.session.token });
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Stock reservation failed/i);
  });

  await t.test('places order successfully with stock reservation and valid payment', () => {
    const auth = authenticateUser('alice@example.com', 'alicePass1');

    restockItem('LAPTOP-001', 10);

    const cart = new ShoppingCart(auth.user.id);
    cart.addItem('LAPTOP-001', 'Developer Laptop', 1200, 1);

    const result = placeOrder({ cart, userToken: auth.session.token, cardLast4: '4242' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'CONFIRMED');
    assert.ok(result.orderId.startsWith('ord_'));
    assert.strictEqual(result.customer.email, 'alice@example.com');
    assert.ok(result.pricing.total > 1200); // includes tax
  });
});
