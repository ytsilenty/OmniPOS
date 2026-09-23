// src/ui/components/toast.js — transient notifications. Singleton container.

import { esc } from '../../core/utils.js';

let _container = null;

function ensureContainer() {
  if (_container && document.body.contains(_container)) return _container;
  _container = document.createElement('div');
  _container.className = 'toasts';
  _container.setAttribute('aria-live', 'polite');
  document.body.appendChild(_container);
  return _container;
}

/**
 * Show a toast message.
 * type: '' | 'ok' | 'bad' | 'warn'
 */
export function toast(msg, type = '', ms = 2600) {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast--' + type : '');
  el.innerHTML = esc(msg);
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--in'));
  setTimeout(() => {
    el.classList.remove('toast--in');
    setTimeout(() => el.remove(), 250);
  }, Math.max(300, ms));
}
