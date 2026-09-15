/**
 * Shared VAT helpers for cash sale revenue figures.
 *
 * CashSale.totalAmount is always the pre-tax subtotal. The real VAT amount
 * comes from Odoo (CashSale.vatAmount, populated after the sale syncs) —
 * Odoo's tax rates are NOT a flat 15% across all products (some are 0%/
 * exempt), so a flat estimate is only a stand-in until the real Odoo figure
 * is available.
 */

export const ESTIMATED_VAT_RATE = 0.15;

export function grandTotal(sale: { totalAmount: number; vatAmount?: number | null }): number {
  const vat = sale.vatAmount ?? sale.totalAmount * ESTIMATED_VAT_RATE;
  return sale.totalAmount + vat;
}

export function sumGrandTotal(sales: { totalAmount: number; vatAmount?: number | null }[]): number {
  return sales.reduce((sum, s) => sum + grandTotal(s), 0);
}
