import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCents, formatMoney } from './src/money.js';
test('formats cents without losing trailing zeros', () => assert.equal(formatMoney(1230), '$12.30'));
test('formats zero', () => assert.equal(formatMoney(0), '$0.00'));
test('rejects fractional and negative cents', () => { assert.throws(() => assertCents(1.5)); assert.throws(() => assertCents(-1)); });
