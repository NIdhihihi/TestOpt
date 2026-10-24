import { assertCents } from './money.js';
const RATES = new Map([['SAVE10', 0.15], ['SAVE5', 0.05]]);
export function discountCents(subtotalCents, coupon = '') {
  assertCents(subtotalCents);
  const rate = RATES.get(String(coupon).trim().toUpperCase()) ?? 0;
  return Math.round(subtotalCents * rate);
}
