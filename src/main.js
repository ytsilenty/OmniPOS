// src/main.js — boot: load DB → setup/login → app shell → view router.

import { getDB, loadDB, saveDB, sessionGet, sessionSet, sessionClear } from './core/db.js';
import { setDbGetter } from './core/money.js';
import { num } from './core/utils.js';
import { mountShell, setTopbar, renderTabs, getViewContainer, setCurrentView } from './ui/layouts/app-shell.js';
import { mountSetup, buildAdminUser } from './ui/views/auth/setup.view.js';
import { mountLogin } from './ui/views/auth/login.view.js';
import { mountRegister } from './ui/views/register/register.view.js';

const app = document.getElementById('app');
let SESSION = null;
let currentUnmount = null;

setDbGetter(getDB);

const VIEWS = {
  register: (container) => mountRegister(container, { user: SESSION, onCheckout: () => {} }),
  products: placeholder('Products'),
  customers: placeholder('Customers'),
  sales: placeholder('Sales history'),
  reports: placeholder('Reports'),
  settings: placeholder('Settings'),
};

function placeholder(name) {
  return (container) => {
    container.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'placeholder';
    div.textContent = name + ' — Coming next…';
    container.appendChild(div);
    return { unmount: () => div.remove() };
  };
}

function seedDemoData(db) {
  if (db.categories.length || db.products.length) return;
  const cats = [
    { id: 'cat_gen', name: 'General', color: '#3b82f6' },
    { id: 'cat_gro', name: 'Grocery', color: '#22c55e' },
    { id: 'cat_bev', name: 'Beverages', color: '#f59e0b' },
  ];
  db.categories = cats;
  db.products = [
    { id: 'prd_1', name: 'Test Product A', sku: 'TST-001', barcode: '8901234567890', categoryId: 'cat_gen', price: 12.5, cost: 7, stock: 40, unit: 'pcs', trackStock: true, taxable: true, isService: false, active: true },
    { id: 'prd_2', name: 'Test Product B', sku: 'TST-002', barcode: '', categoryId: 'cat_gro', price: 3.99, cost: 1.5, stock: 4, unit: 'pcs', trackStock: true, taxable: true, isService: false, active: true },
    { id: 'prd_3', name: 'Coffee', sku: 'BEV-001', barcode: '', categoryId: 'cat_bev', price: 2.5, cost: 0.6, stock: 100, unit: 'cup', trackStock: true, taxable: true, isService: false, active: true },
    { id: 'prd_4', name: 'Haircut Service', sku: 'SVC-001', barcode: '', categoryId: 'cat_gen', price: 25, cost: 0, stock: 0, unit: 'hr', trackStock: false, taxable: true, isService: true, serviceRate: 25, active: true },
    { id: 'prd_5', name: 'Sold Out Item', sku: 'TST-005', barcode: '', categoryId: 'cat_gen', price: 9.99, cost: 5, stock: 0, unit: 'pcs', trackStock: true, taxable: true, isService: false, active: true },
  ];
  db.customers = [
    { id: 'cus_1', name: 'Alice Walker', phone: '+1 555 0100', email: '', points: 120, credit: 0, totalSpent: 240, birthday: '', note: '', tags: [], createdAt: new Date().toISOString() },
    { id: 'cus_2', name: 'Bob Chen', phone: '+1 555 0101', email: '', points: 0, credit: 15, totalSpent: 88.5, birthday: '', note: '', tags: [], createdAt: new Date().toISOString() },
  ];
  db.giftCards = [{ id: 'gc_1', code: 'GIFT10', balance: 10, expires: '', note: 'demo', at: new Date().toISOString() }];
  saveDB();
}

async function afterAuth(user) {
  SESSION = user;
  sessionSet({ userId: user.id, at: new Date().toISOString() });
  startShell();
}

function startShell() {
  const db = getDB();
  mountShell(app, {
    onLock: () => {
      sessionClear();
      SESSION = null;
      if (currentUnmount) currentUnmount();
      showLogin();
    },
    onSwitch: (id) => switchView(id),
  });
  const outlet = (db.settings.outlets || []).find((o) => o.id === db.settings.outletId);
  setTopbar({ storeName: db.settings.storeName, outletName: outlet ? outlet.name : '', user: SESSION });
  renderTabs(SESSION, 'register');
  setCurrentView('register');
  switchView('register');
}

function switchView(id) {
  if (currentUnmount && typeof currentUnmount === 'function') {
    currentUnmount();
    currentUnmount = null;
  }
  const container = getViewContainer();
  setCurrentView(id);
  const factory = VIEWS[id] || placeholder(id);
  const mounted = factory(container) || {};
  currentUnmount = mounted.unmount || null;
}

function showLogin() {
  const db = getDB();
  const m = mountLogin(app, { db, onLogin: afterAuth });
  currentUnmount = m.unmount;
}

async function handleSetup(payload) {
  const db = loadDB();
  if (!payload.storeName || !payload.adminName || payload.adminPassword.length < 4) {
    alert('Please fill store name, your name and a password (min 4 chars).');
    return;
  }
  db.settings.storeName = payload.storeName;
  db.settings.currency.code = payload.currencyCode;
  db.settings.currency.symbol = payload.currencySymbol;
  db.settings.tax.rate = num(payload.taxRate, 0);
  const admin = await buildAdminUser({ name: payload.adminName, password: payload.adminPassword, pin: payload.adminPin });
  db.users.push(admin);
  db.settings.tutorialSeen = true;
  saveDB();
  seedDemoData(db);
  await afterAuth(admin);
}

async function boot() {
  const db = loadDB();
  if (!db.users || !db.users.length) {
    mountSetup(app, { onSubmit: handleSetup });
    return;
  }
  const sess = sessionGet();
  const user = sess && (db.users || []).find((u) => u.id === sess.userId && u.active !== false);
  if (user) {
    await afterAuth(user);
  } else {
    showLogin();
  }
}

boot();
