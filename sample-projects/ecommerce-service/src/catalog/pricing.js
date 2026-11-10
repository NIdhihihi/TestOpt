export const TAX_RATES = {
  US_CA: 0.0825,
  US_NY: 0.08875,
  EU_STANDARD: 0.20,
  DEFAULT: 0.05,
};

export function calculateSubtotal(items = []) {
  return items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
}

export function applyCouponDiscount(subtotal, couponCode) {
  if (!couponCode) return { discount: 0, finalSubtotal: subtotal };
  const code = couponCode.trim().toUpperCase();
  let discount = 0;

  if (code === 'SAVE10') {
    discount = subtotal * 0.10;
  } else if (code === 'SAVE25' && subtotal >= 50) {
    discount = subtotal * 0.25;
  } else if (code === 'FLAT15' && subtotal >= 30) {
    discount = 15;
  }

  discount = Math.min(subtotal, Math.round(discount * 100) / 100);
  return { discount, finalSubtotal: Math.round((subtotal - discount) * 100) / 100 };
}

export function calculateTax(amount, region = 'DEFAULT') {
  const rate = TAX_RATES[region] ?? TAX_RATES.DEFAULT;
  return Math.round(amount * rate * 100) / 100;
}

export function computeTotalOrderPrice(items, couponCode, region) {
  const subtotal = calculateSubtotal(items);
  const { discount, finalSubtotal } = applyCouponDiscount(subtotal, couponCode);
  const tax = calculateTax(finalSubtotal, region);
  const total = Math.round((finalSubtotal + tax) * 100) / 100;
  return { subtotal, discount, tax, total };
}

