// src/ui/layouts/app-shell.js — topbar, tabs and view container. Owns the app frame.

import { esc } from '../../core/utils.js';
import { getDB } from '../../core/db.js';
import { money } from '../../core/money.js';

export const TABS = [
  { id: 'register', label: 'Register' },
  { id: 'products', label: 'Products' },
  { id: 'customers', label: 'Customers' },
  { id: 'sales', label: 'Sales' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
];

let _shell = null; // { root, topbarEl, tabsEl, viewEl, activeId, clockTimer }

/**
 * Mount the application shell into root (replaces content).
 * opts: { onLock, onSwitch }
 */
export function mountShell(root, opts = {}) {
  unmountClock();
  root.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'topbar';
  header.id = 'topbar';

  const tabsBar = document.createElement('nav');
  tabsBar.className = 'tabs';
  tabsBar.id = 'tabs';

  const main = document.createElement('main');
  main.className = 'layout';
  main.id = 'view';

  root.appendChild(header);
  root.appendChild(tabsBar);
  root.appendChild(main);

  _shell = { root, topbarEl: header, tabsEl: tabsBar, viewEl: main, activeId: null, clockTimer: null };

  header.addEventListener('click', (e) => {
    const lockBtn = e.target.closest('[data-action="lock"]');
    if (lockBtn && typeof opts.onLock === 'function') opts.onLock();
  });

  tabsBar.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    setCurrentView(tab.dataset.tab);
    if (typeof opts.onSwitch === 'function') opts.onSwitch(tab.dataset.tab);
  });

  startClock();
  return _shell;
}

function unmountClock() {
  if (_shell && _shell.clockTimer) clearInterval(_shell.clockTimer);
}

function startClock() {
  _shell.clockTimer = setInterval(() => {
    const el = _shell.topbarEl.querySelector('.clock');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, 15000);
}

/** Update topbar store/outlet/user labels. */
export function setTopbar({ storeName, outletName, user }) {
  if (!_shell) return;
  const db = getDB();
  const parts = [];
  parts.push('<div class="tb-left">');
  parts.push('<span class="tb-store">' + esc(storeName || db.settings.storeName) + '</span>');
  if (outletName) parts.push('<span class="tb-outlet">' + esc(outletName) + '</span>');
  parts.push('</div>');
  parts.push('<div class="tb-right">');
  parts.push('<span class="tb-user">' + esc(user ? user.name : '') + '</span>');
  parts.push('<span class="clock">' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>');
  parts.push('<button class="btn ghost sm" type="button" data-action="lock">🔒 Lock</button>');
  parts.push('</div>');
  _shell.topbarEl.innerHTML = parts.join('');
}

/** Render the tab bar for a user, highlighting activeId. */
export function renderTabs(user, activeId) {
  if (!_shell) return;
  const visible = TABS.filter((t) => t.id !== 'settings' || (user && (user.role === 'admin' || user.role === 'manager')));
  const parts = [''];
  for (const t of visible) {
    parts.push('<button class="tab' + (t.id === activeId ? ' tab--active' : '') + '" type="button" data-tab="' + esc(t.id) + '">' + esc(t.label) + '</button>');
  }
  _shell.tabsEl.innerHTML = parts.join('');
}

/** Get the #view container where views mount. */
export function getViewContainer() {
  return _shell ? _shell.viewEl : document.getElementById('view');
}

/** Switch active tab highlight (content swap is handled by the caller via onSwitch). */
export function setCurrentView(id) {
  if (!_shell) return;
  _shell.activeId = id;
  const tabs = _shell.tabsEl.querySelectorAll('[data-tab]');
  for (const t of tabs) t.classList.toggle('tab--active', t.dataset.tab === id);
}

/** Small helper used across views to format amounts consistently in headers. */
export function shellMoney(v) {
  return money(v);
}
