import { assertCents } from './money.js';
export function discountCents(subtotalCents, coupon = '') {
  assertCents(subtotalCents);
  const code = String(coupon).trim().toUpperCase();
  if (code === 'SAVE10') return Math.round(subtotalCents * 0.10);
  if (code === 'SAVE5') return Math.round(subtotalCents * 0.05);
  return 0;
}
