import { assertCents } from './money.js';
export function shippingCents(subtotalCents) {
  assertCents(subtotalCents);
  return subtotalCents === 0 || subtotalCents >= 5000 ? 0 : 399;
}
