// src/ui/components/modal.js — lightweight modal dialogs with Escape-to-close.
// Callers must escape user data before passing HTML strings.

const _stack = [];

/**
 * Open a modal.
 * @param {string} title        plain-text title (escaped internally)
 * @param {string} bodyHTML     trusted HTML (escape any user data yourself via esc())
 * @param {string} footerHTML   trusted HTML for the footer area
 * @param {object} opts         { wide?: boolean, onClose?: fn }
 * @returns {{el: HTMLElement, close: fn}}
 */
export function modal(title, bodyHTML, footerHTML = '', opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const parts = [];
  parts.push('<div class="modal" role="dialog" aria-modal="true">');
  parts.push('<div class="modal-head"><span class="modal-title">' + escTitle(title) + '</span>');
  parts.push('<button class="modal-x" type="button" data-action="modal-close" aria-label="Close">✕</button></div>');
  parts.push('<div class="modal-body">' + (bodyHTML || '') + '</div>');
  if (footerHTML) parts.push('<div class="modal-foot">' + footerHTML + '</div>');
  parts.push('</div>');

  overlay.innerHTML = parts.join('');
  if (opts.wide) overlay.querySelector('.modal').classList.add('modal--wide');

  const close = () => closeModal(entry);
  const entry = { overlay, close, onClose: opts.onClose || null };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-action="modal-close"]')) {
      closeModal(entry);
    }
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-overlay--in'));
  _stack.push(entry);

  const focusTarget = overlay.querySelector('input, button.primary, .modal-foot button:last-child');
  if (focusTarget) setTimeout(() => focusTarget.focus(), 30);

  return { el: overlay, close };
}

function escTitle(t) {
  // local import cycle avoidance: title is plain text
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Close one modal (or its element). */
export function closeModal(entryOrEl) {
  let entry = entryOrEl;
  if (entryOrEl instanceof HTMLElement) {
    entry = _stack.find((en) => en.overlay === entryOrEl);
  }
  if (!entry) return;
  const idx = _stack.indexOf(entry);
  if (idx < 0) return; // already closed
  _stack.splice(idx, 1);
  entry.overlay.classList.remove('modal-overlay--in');
  setTimeout(() => entry.overlay.remove(), 200);
  if (typeof entry.onClose === 'function') entry.onClose();
}

/** Close all open modals (top-most last). */
export function closeAllModals() {
  while (_stack.length) closeModal(_stack[_stack.length - 1]);
}

// Global Escape handler — closes topmost modal.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _stack.length) {
    e.preventDefault();
    closeModal(_stack[_stack.length - 1]);
  }
});
