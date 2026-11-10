import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReceipt, verifyReceipt } from '../src/notifications/receipts.js';

test('receipts - digital order receipt generation and verification', async (t) => {
  const sampleOrder = {
    orderId: 'ord_sample_987',
    customer: { email: 'customer@example.com', name: 'Sam Customer' },
    items: [
      { sku: 'ITEM-1', name: 'Item 1', price: 29.99, quantity: 2 },
      { sku: 'ITEM-2', name: 'Item 2', price: 15.0, quantity: 1 },
    ],
    pricing: {
      subtotal: 74.98,
      tax: 6.18,
      total: 81.16,
    },
  };

  await t.test('throws error on missing order information', () => {
    assert.throws(() => generateReceipt(null), /Invalid order object/i);
    assert.throws(() => generateReceipt({}), /Invalid order object/i);
  });

  await t.test('generates valid signed receipt', () => {
    const receipt = generateReceipt(sampleOrder);
    assert.strictEqual(receipt.orderId, 'ord_sample_987');
    assert.strictEqual(receipt.customerEmail, 'customer@example.com');
    assert.strictEqual(receipt.total, 81.16);
    assert.strictEqual(receipt.itemCount, 3);
    assert.ok(receipt.signature);
    assert.ok(receipt.summaryText.includes('$81.16'));

    const isValid = verifyReceipt(receipt);
    assert.strictEqual(isValid, true);
  });

  await t.test('detects tampering in receipt total or customer', () => {
    const receipt = generateReceipt(sampleOrder);

    const tamperedTotal = { ...receipt, total: 10.0 };
    assert.strictEqual(verifyReceipt(tamperedTotal), false);

    const tamperedCustomer = { ...receipt, customerEmail: 'hacker@example.com' };
    assert.strictEqual(verifyReceipt(tamperedCustomer), false);
  });
});

