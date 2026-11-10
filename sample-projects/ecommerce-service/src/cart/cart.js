import { computeTotalOrderPrice } from '../catalog/pricing.js';
import { checkAvailability } from '../catalog/inventory.js';

export class ShoppingCart {
  constructor(userId, region = 'US_CA') {
    this.userId = userId;
    this.region = region;
    this.items = [];
    this.couponCode = null;
  }

  addItem(sku, name, price, quantity = 1) {
    const stock = checkAvailability(sku, quantity);
    if (!stock.available) {
      throw new Error(`Item ${sku} cannot be added: ${stock.reason}`);
    }
    const existing = this.items.find((i) => i.sku === sku);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.items.push({ sku, name, price, quantity });
    }
    return this.items;
  }

  removeItem(sku) {
    this.items = this.items.filter((i) => i.sku !== sku);
  }

  applyCoupon(couponCode) {
    this.couponCode = couponCode;
  }

  getCheckoutSummary() {
    return computeTotalOrderPrice(this.items, this.couponCode, this.region);
  }
}

