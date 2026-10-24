import test from 'node:test';
import assert from 'node:assert/strict';
import { reserve } from './src/inventory.js';
test('reserves stock without mutating the original', () => { const stock = { BOOK: 5 }; assert.deepEqual(reserve(stock, 'BOOK', 2), { BOOK: 3 }); assert.equal(stock.BOOK, 5); });
test('rejects insufficient stock', () => assert.throws(() => reserve({ BOOK: 1 }, 'BOOK', 2), /Insufficient/));
test('rejects an unknown product', () => assert.throws(() => reserve({}, 'BOOK', 1), /Unknown/));
