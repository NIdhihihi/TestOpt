const stockWarehouse = new Map([
  ['sku_laptop', { name: 'Pro Laptop', stock: 15 }],
  ['sku_mouse', { name: 'Wireless Mouse', stock: 50 }],
  ['sku_keyboard', { name: 'Mechanical Keyboard', stock: 8 }],
]);

export function checkAvailability(sku, requestedQty = 1) {
  const item = stockWarehouse.get(sku);
  if (!item) return { available: false, remaining: 0, reason: 'SKU not found' };
  if (item.stock < requestedQty) {
    return { available: false, remaining: item.stock, reason: 'Insufficient stock' };
  }
  return { available: true, remaining: item.stock };
}

export function reserveStock(sku, qty = 1) {
  const check = checkAvailability(sku, qty);
  if (!check.available) return false;
  const item = stockWarehouse.get(sku);
  item.stock -= qty;
  return true;
}

export function releaseStock(sku, qty = 1) {
  const item = stockWarehouse.get(sku);
  if (item) item.stock += qty;
}

