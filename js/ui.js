/* Small DOM/UI helpers shared by every maintenance page. Everything that comes
 * from the API is escaped before it reaches innerHTML. */

import { Api } from './api.js';

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M6 16c.6-1.6 1.7-2.3 3-2.3s2.4.7 3 2.3"/><path d="M15 10h4M15 13.5h4M15 17h2.5"/>',
  car: '<path d="M5.2 11.2 6.7 6.8A2 2 0 0 1 8.6 5.4h6.8a2 2 0 0 1 1.9 1.4l1.5 4.4"/><path d="M3.6 11.4h16.8v4.4h-1.9a2 2 0 0 1-4 0H9.5a2 2 0 0 1-4 0H3.6z"/><circle cx="7.4" cy="15.9" r=".9"/><circle cx="16.6" cy="15.9" r=".9"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3.5 2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};

export function icon(name, size = 18) {
  const body = ICONS[name] || ICONS.alert;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.dataset.iconPainted) {
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, 17));
      el.dataset.iconPainted = '1';
    }
  });
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('') || '?';
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString([], { dateStyle: 'medium' });
}

export function timeAgo(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return String(value);
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return fmtDate(value);
}

const STATUS = {
  verified: { label: 'Verified', cls: 'badge--success', ic: 'check' },
  approved: { label: 'Approved', cls: 'badge--success', ic: 'check' },
  submitted: { label: 'In review', cls: 'badge--brand', ic: 'clock' },
  pending: { label: 'In review', cls: 'badge--brand', ic: 'clock' },
  rejected: { label: 'Rejected', cls: 'badge--danger', ic: 'x' },
  unverified: { label: 'Not started', cls: 'badge--warn', ic: 'alert' },
  not_started: { label: 'Not started', cls: 'badge--warn', ic: 'alert' },
};

export function statusBadge(status) {
  const meta = STATUS[status] || STATUS.unverified;
  return `<span class="badge ${meta.cls}">${icon(meta.ic, 12)} ${esc(meta.label)}</span>`;
}

export const DOC_TYPES = {
  dl: 'Driving licence',
  aadhaar: 'Aadhaar',
  passport: 'Passport',
  voter_id: 'Voter ID',
  rc: 'Registration certificate',
  insurance: 'Insurance',
};

export function emptyState({ title = 'Nothing here', desc = '', ic = 'shield', action = '' } = {}) {
  return `<div class="empty">${icon(ic, 42)}<b>${esc(title)}</b>${desc ? `<p>${desc}</p>` : ''}${action}</div>`;
}

export function skeletonCards(count = 3) {
  return Array.from({ length: count }, () =>
    '<div class="skeleton" style="height:150px"></div>').join('');
}

/* ------------------------------------------------------------------- toasts */
export function toast(message, type = 'info', ms = 4200) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  const ic = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'shield';
  el.innerHTML = `${icon(ic, 16)}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* -------------------------------------------------------------------- modal */
export function openModal({ title = '', subtitle = '', body = '', foot = '', lg = false } = {}) {
  const root = document.getElementById('modalRoot');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${lg ? 'modal--lg' : ''}" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button class="iconbtn" data-close aria-label="Close">${icon('x', 18)}</button>
      </div>
      <div class="modal__body">${body}</div>
      ${foot ? `<div class="modal__foot">${foot}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  const close = () => {
    backdrop.remove();
    document.body.style.overflow = '';
  };
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  return { el: backdrop, close };
}

export function confirmDialog({
  title = 'Are you sure?', message = '', confirmLabel = 'Confirm',
  danger = false, cancelLabel = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    const { el, close } = openModal({
      title,
      body: `<p class="text-muted">${esc(message)}</p>`,
      foot: `<button class="btn btn--ghost" data-no>${esc(cancelLabel)}</button>
             <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(confirmLabel)}</button>`,
    });
    el.querySelector('[data-no]').addEventListener('click', () => { close(); resolve(false); });
    el.querySelector('[data-yes]').addEventListener('click', () => { close(); resolve(true); });
  });
}

/* Reason prompt shared by every rejection path: the backend refuses a rejection
 * without a reason, and the person receiving it needs something actionable. */
export function reasonDialog({
  title, subject, codeOptions = [], confirmLabel = 'Reject',
} = {}) {
  return new Promise((resolve) => {
    const codes = codeOptions.map(([value, label]) =>
      `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    const { el, close } = openModal({
      title,
      subtitle: subject || '',
      body: `
        <div class="field">
          <label for="rejectReason">Reason shown to the captain (required)</label>
          <textarea class="textarea" id="rejectReason" maxlength="300"
            placeholder="e.g. The licence photo is too blurry to read the number. Upload a sharper photo."></textarea>
          <p class="field__hint">Be specific: this text is what the captain sees, and it is audited.</p>
        </div>
        ${codes ? `<div class="field mt-12">
          <label for="rejectCode">Reason code (optional, internal)</label>
          <select class="select" id="rejectCode">${codes}</select>
        </div>` : ''}`,
      foot: `<button class="btn btn--ghost" data-no>Cancel</button>
             <button class="btn btn--danger" data-yes>${esc(confirmLabel)}</button>`,
    });
    const reasonEl = el.querySelector('#rejectReason');
    const codeEl = el.querySelector('#rejectCode');
    const yes = el.querySelector('[data-yes]');
    reasonEl.focus();
    el.querySelector('[data-no]').addEventListener('click', () => { close(); resolve(null); });
    yes.addEventListener('click', () => {
      const reason = reasonEl.value.trim();
      if (reason.length < 4) {
        reasonEl.focus();
        reasonEl.style.borderColor = 'var(--danger)';
        reasonEl.placeholder = 'A reason is required (at least a few words).';
        return;
      }
      close();
      resolve({ reason, rejection_code: codeEl ? codeEl.value : undefined });
    });
  });
}

/* -------------------------------------------------------------- doc viewer */
export async function viewDocument(path, label = 'Document') {
  const { el, close } = openModal({
    title: label,
    subtitle: 'Private document — viewed under your staff account; the read is audited.',
    lg: true,
    body: `<div class="page-loading"><span class="spinner"></span> Loading document…</div>`,
  });
  try {
    const { blob, type } = await Api.document(path);
    const url = URL.createObjectURL(blob);
    const bodyEl = el.querySelector('.modal__body');
    if (type.startsWith('image/')) {
      bodyEl.innerHTML = `<img class="doc-viewer--img" alt="Uploaded document"
        src="${url}" />`;
    } else {
      bodyEl.innerHTML = `<iframe class="doc-viewer" title="Uploaded document"
        src="${url}"></iframe>`;
    }
    const foot = document.createElement('div');
    foot.className = 'modal__foot';
    foot.innerHTML = '<button class="btn btn--ghost" data-close-doc>Close</button>';
    foot.querySelector('[data-close-doc]').addEventListener('click', close);
    el.querySelector('.modal').appendChild(foot);
    const img = bodyEl.querySelector('img');
    if (img) img.addEventListener('load', () => {}, { once: true });
    el.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]') || event.target.closest('[data-close-doc]')) {
        URL.revokeObjectURL(url);
      }
    });
    const observer = new MutationObserver(() => {
      if (!el.isConnected) { URL.revokeObjectURL(url); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true });
  } catch (err) {
    // 404 here means the metadata says a file exists but the bytes are gone --
    // documents uploaded before durable storage was on were erased by a
    // redeploy. Say that, and say what fixes it, instead of "File not found."
    const lost = err && (err.status === 404 || err.code === 'not_found');
    el.querySelector('.modal__body').innerHTML = lost
      ? `<div class="note">${icon('alert', 14)} This file is no longer stored on the server, so there is nothing to show.
          Documents uploaded before durable storage was enabled were erased when the app redeployed.
          Ask the captain to upload it again from <b>My vehicles</b> — once re-uploaded it opens here normally.</div>`
      : `<div class="note">${icon('alert', 14)} ${esc(err.message)}</div>`;
  }
}
