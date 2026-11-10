import { getUserById } from '../auth/users.js';
import { reserveStock } from '../catalog/inventory.js';
import { processPayment } from './payments.js';

export function placeOrder({ cart, userToken, cardLast4 = '4242' }) {
  if (!cart.items.length) {
    return { success: false, error: 'Cannot checkout with an empty cart' };
  }

  const user = getUserById(cart.userId);
  if (!user) {
    return { success: false, error: 'User account could not be found' };
  }

  // 1. Calculate pricing
  const summary = cart.getCheckoutSummary();

  // 2. Reserve warehouse inventory
  for (const item of cart.items) {
    const reserved = reserveStock(item.sku, item.quantity);
    if (!reserved) {
      return { success: false, error: `Stock reservation failed for item: ${item.sku}` };
    }
  }

  // 3. Process payment
  const paymentResult = processPayment({
    userToken,
    amount: summary.total,
    cardLast4,
  });

  if (!paymentResult.success) {
    return { success: false, error: `Payment failed: ${paymentResult.error}` };
  }

  const orderId = `ord_${Date.now().toString(36)}`;
  return {
    success: true,
    orderId,
    customer: user,
    items: [...cart.items],
    pricing: summary,
    receiptRef: paymentResult.receiptRef,
    status: 'CONFIRMED',
  };
}

