export function reserve(stock, sku, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be positive.');
  if (!(sku in stock)) throw new Error('Unknown product.');
  if (stock[sku] < quantity) throw new Error('Insufficient stock.');
  return { ...stock, [sku]: stock[sku] - quantity };
}
