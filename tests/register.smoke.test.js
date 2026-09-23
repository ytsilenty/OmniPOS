import { describe, it, expect, beforeEach } from 'vitest';

globalThis.localStorage = (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; })();
globalThis.sessionStorage = (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; })();

const { loadDB, getDB, saveDB } = await import('/workspace/src/core/db.js');
const cart = await import('/workspace/src/services/cart.service.js');
const { calculateTotals } = await import('/workspace/src/services/pricing.service.js');
const { completeSale } = await import('/workspace/src/services/sale.service.js');
const { money } = await import('/workspace/src/core/money.js');

describe('register flow services', () => {
  beforeEach(() => {
    const db = loadDB();
    db.products = [{ id:'p1', name:'A', sku:'S1', price:10, cost:4, stock:10, unit:'pcs', trackStock:true, taxable:true, active:true }];
    db.categories=[]; db.sales=[]; db.moves=[]; db.customers=[]; db.held=[]; db.auditLog=[]; db.shifts=[]; db.giftCards=[];
    db.settings.tax = { enabled:true, label:'Tax', rate:10, inclusive:false };
    db.settings.rounding = { enabled:false, nearest:0.05, applyTo:'total' };
    saveDB();
    cart.clear();
  });

  it('add + totals + discount + tax', () => {
    const p = getDB().products[0];
    cart.addItem(p);
    cart.addItem(p, { qty: 2 }); // wait — addItem merges
    const items = cart.getItems();
    expect(items.length).toBe(1);
    expect(items[0].qty).toBe(3);
    const t = cart.totals();
    expect(t.sub).toBe(30);
    expect(t.tax).toBeCloseTo(3);
    expect(t.total).toBeCloseTo(33);
    cart.setOrderDiscount({ type:'percent', value: 10 });
    const t2 = cart.totals();
    expect(t2.orderDisc).toBe(3);
    expect(t2.total).toBeCloseTo(29.7);
  });

  it('hold/recall', () => {
    cart.addItem(getDB().products[0]);
    const ticket = cart.hold('T1');
    expect(ticket).toBeTruthy();
    expect(cart.getItems().length).toBe(0);
    expect(cart.recall(ticket.id)).toBe(true);
    expect(cart.getItems().length).toBe(1);
  });

  it('completeSale decrements stock and stores sale', () => {
    cart.addItem(getDB().products[0], { qty: 2 });
    const snap = cart.snapshot();
    const user = { id:'u1', name:'Admin' };
    const sale = completeSale({ cart: snap, totals: snap.totals, payments:[{method:'cash', amount: snap.totals.total}], change: 0, user, shift: null });
    expect(sale.no).toMatch(/^INV\d{6}$/);
    expect(getDB().products[0].stock).toBe(8);
    expect(getDB().sales.length).toBe(1);
    expect(money(sale.total)).toBe('$22.00');
  });

  it('qty stepper via setQty/remove', () => {
    cart.addItem(getDB().products[0]);
    const lineId = cart.getItems()[0].lineId;
    cart.incrementQty(lineId);
    expect(cart.getItems()[0].qty).toBe(2);
    cart.decrementQty(lineId);
    expect(cart.getItems()[0].qty).toBe(1);
    cart.removeItem(lineId);
    expect(cart.getItems().length).toBe(0);
  });

  it('subscriber fires on mutations', () => {
    let n = 0;
    const un = cart.subscribe(() => n++);
    cart.addItem(getDB().products[0]);
    expect(n).toBe(1);
    un();
    cart.addItem(getDB().products[0]);
    expect(n).toBe(1);
  });
});
