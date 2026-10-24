import { assertCents, formatMoney } from './money.js';
import { discountCents } from './discounts.js';
import { shippingCents } from './shipping.js';
export function checkout(items, coupon = '') {
  let subtotalCents = 0;
  for (const item of items) {
    assertCents(item.priceCents);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Quantity must be a positive integer.');
    subtotalCents += item.priceCents * item.quantity;
  }
  const discount = discountCents(subtotalCents, coupon);
  const shipping = shippingCents(subtotalCents);
  const totalCents = subtotalCents - discount + shipping;
  return { subtotalCents, discountCents: discount, shippingCents: shipping, totalCents, displayTotal: formatMoney(totalCents) };
}
