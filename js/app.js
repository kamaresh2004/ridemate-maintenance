/* RideMate Captain Maintenance — standalone staff console.
 *
 * Routes:
 *   #/overview   queue counts + recent audit
 *   #/identity   captain identity KYC queue (approve / reject / view document)
 *   #/vehicles   vehicle DL + insurance packet review
 *   #/rc         registration certificate review
 *   #/users      people directory, roles and legacy licence/insurance flags
 *   #/audit      audit trail
 *
 * The server is the authority on every decision. This console only mirrors
 * what the API reports and posts a reviewer's decision back to it; there is no
 * client-side "approve" that bypasses the backend state machine.
 */

import { Api, ApiError, session, getApiBase, setApiBase } from './api.js';
import {
  icon, paintIcons, esc, initials, fmtDateTime, fmtDate, timeAgo,
  statusBadge, emptyState, skeletonCards, toast, openModal, confirmDialog,
  reasonDialog, viewDocument, DOC_TYPES,
} from './ui.js';

const STAFF_ROLES = ['admin', 'support'];

const ROUTES = {
  overview: { title: 'Overview', eyebrow: 'Trust & Safety', render: renderOverview },
  identity: { title: 'Identity KYC', eyebrow: 'Riders + captains', render: renderIdentity },
  vehicles: { title: 'Vehicle KYC', eyebrow: 'Licence + insurance', render: renderVehicles },
  rc: { title: 'Registration certificates', eyebrow: 'Vehicle papers', render: renderRc },
  users: { title: 'People', eyebrow: 'Directory & roles', render: renderUsers },
  audit: { title: 'Audit log', eyebrow: 'Every staff decision', render: renderAudit },
};

const app = {
  user: null,
  route: 'overview',
  refreshCurrent: null,
};

/* ------------------------------------------------------------------- boot */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  paintIcons();
  wireLogin();
  wireShell();

  const apiInput = document.getElementById('apiBaseInput');
  apiInput.value = getApiBase();
  document.getElementById('apiBaseHint').textContent =
    `Current target: ${getApiBase()}`;

  try {
    const user = await Api.restore();
    if (!STAFF_ROLES.includes(user.role)) {
      await Api.logout();
      showLogin('This account is not a staff reviewer. Ask an admin to grant the admin or support role.');
      return;
    }
    enterApp(user);
  } catch {
    showLogin();
  }
}

function showLogin(message = '') {
  document.getElementById('authView').hidden = false;
  document.getElementById('appView').hidden = true;
  const error = document.getElementById('loginError');
  if (message) {
    error.textContent = message;
    error.hidden = false;
  } else {
    error.hidden = true;
  }
}

function wireLogin() {
  const form = document.getElementById('loginForm');
  const error = document.getElementById('loginError');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const button = document.getElementById('loginBtn');
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const apiInput = document.getElementById('apiBaseInput');
    if (apiInput.value.trim()) setApiBase(apiInput.value);
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const data = await Api.login(email, password);
      if (!STAFF_ROLES.includes(data.user?.role)) {
        await Api.logout();
        throw new ApiError(
          'This account is not a staff reviewer. Ask an admin to grant the admin or support role.',
          403, 'forbidden');
      }
      session.save(data.token, data.user);
      form.reset();
      enterApp(data.user);
    } catch (err) {
      error.textContent = err.message || 'Sign-in failed.';
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in to review';
    }
  });
}

function wireShell() {
  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('maint:logout', () => {
    showLogin('Your session ended. Sign in again.');
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await Api.logout();
    showLogin();
  });
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    if (app.refreshCurrent) {
      const button = document.getElementById('refreshBtn');
      button.disabled = true;
      try { await app.refreshCurrent(); } finally { button.disabled = false; }
    }
  });
}

function enterApp(user) {
  app.user = user;
  document.getElementById('authView').hidden = true;
  document.getElementById('appView').hidden = false;

  document.getElementById('sideName').textContent = user.name || user.email || 'Reviewer';
  document.getElementById('sideRole').textContent = `${user.role} reviewer`;
  document.getElementById('sideAvatar').textContent = initials(user.name || user.email);
  document.getElementById('envChip').textContent = getApiBase();
  document.getElementById('envChip').title = `API: ${getApiBase()}`;

  if (!location.hash || !ROUTES[location.hash.replace(/^#\//, '')]) {
    location.hash = '#/overview';
  } else {
    routeFromHash();
  }
  refreshCounts();
}

function routeFromHash() {
  const key = location.hash.replace(/^#\//, '').split('?')[0] || 'overview';
  const route = ROUTES[key] ? key : 'overview';
  app.route = route;
  document.querySelectorAll('.nav__item').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.route === route);
  });
  const main = document.getElementById('main');
  main.innerHTML = '<div class="page-loading"><span class="spinner"></span> Loading…</div>';
  setPageHeader(ROUTES[route]);
  app.refreshCurrent = null;
  ROUTES[route].render(main)
    .then(() => paintIcons(main))
    .catch((err) => {
      main.innerHTML = errorPanel(err);
    });
}

function setPageHeader(route) {
  document.getElementById('pageTitle').textContent = route.title;
  document.getElementById('pageEyebrow').textContent = route.eyebrow;
}

function errorPanel(err) {
  const message = err instanceof ApiError && err.status === 403
    ? 'This account is not allowed to perform that action. Reviewer decisions require the admin or support role.'
    : (err.message || 'The request failed.');
  return `<div class="empty">${icon('alert', 42)}<b>Could not load this section</b>
    <p>${esc(message)}</p>
    <p class="text-xs mt-8">API target: <code>${esc(getApiBase())}</code></p></div>`;
}

function setRefresh(fn) {
  app.refreshCurrent = fn;
}

async function refreshCounts() {
  try {
    const data = await Api.overview();
    const o = data.overview || {};
    setCount('countIdentity', o.identity_pending);
    setCount('countVehicles', o.vehicle_packets_pending ?? o.vehicles_pending_verify);
    setCount('countRc', o.rc_pending);
  } catch { /* the page itself will surface auth/network errors */ }
}

function setCount(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(value) || 0;
  el.textContent = n > 99 ? '99+' : String(n);
  el.hidden = n <= 0;
}

/* --------------------------------------------------------------- decisions */
async function withBusy(button, label, fn) {
  const original = button ? button.innerHTML : '';
  if (button) {
    button.disabled = true;
    button.textContent = label;
  }
  try {
    return await fn();
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

async function approve({ title, message, call, success, reload }) {
  const ok = await confirmDialog({
    title, message, confirmLabel: 'Approve', danger: false,
  });
  if (!ok) return;
  try {
    await call();
    toast(success, 'success');
    await reload();
    refreshCounts();
  } catch (err) {
    toast(err.message || 'The decision could not be recorded.', 'error', 6000);
  }
}

async function reject({ title, subject, call, success, reload }) {
  const payload = await reasonDialog({
    title,
    subject,
    codeOptions: [
      ['', 'No code'],
      ['image_blurry', 'Photo is blurry / unreadable'],
      ['details_mismatch', 'Details do not match the profile'],
      ['expired_document', 'Document has expired'],
      ['wrong_document', 'Wrong document type'],
      ['missing_page', 'Pages are missing'],
      ['other', 'Other'],
    ],
  });
  if (!payload) return;
  try {
    await call(payload);
    toast(success, 'success');
    await reload();
    refreshCounts();
  } catch (err) {
    toast(err.message || 'The decision could not be recorded.', 'error', 6000);
  }
}

/* ---------------------------------------------------------------- overview */
async function renderOverview(root) {
  root.innerHTML = `
    <div class="grid-stats">${skeletonCards(4)}</div>
    <div class="mt-24">${skeletonCards(2)}</div>`;

  const safe = async (promise, fallback) => {
    try { return await promise; } catch { return fallback; }
  };
  const [overview, identity, vehicles, rc, audit] = await Promise.all([
    Api.overview(),
    safe(Api.identityQueue('submitted'), { queue: [] }),
    safe(Api.vehicleQueue(), { data: [] }),
    safe(Api.rcQueue(), { queue: [] }),
    safe(Api.audit({ limit: 8 }), { data: [] }),
  ]);
  const o = overview.overview || {};
  const identityRows = identity.queue || [];
  const vehicleRows = vehicles.data || [];
  const rcRows = rc.queue || [];

  setCount('countIdentity', o.identity_pending ?? identityRows.length);
  setCount('countVehicles', o.vehicle_packets_pending ?? o.vehicles_pending_verify ?? vehicleRows.length);
  setCount('countRc', o.rc_pending ?? rcRows.length);

  const stat = (label, value, hint, cls = '') => `
    <article class="stat ${cls}">
      <div class="stat__label">${esc(label)}</div>
      <div class="stat__value">${esc(value)}</div>
      <div class="stat__hint">${esc(hint)}</div>
    </article>`;

  root.innerHTML = `
    <div class="grid-stats">
      ${stat('Identities waiting', o.identity_pending ?? identityRows.length,
        'Riders and captains', 'stat--alert')}
      ${stat('Vehicle packets waiting', o.vehicle_packets_pending ?? o.vehicles_pending_verify ?? vehicleRows.length,
        'Licence + insurance submissions', 'stat--alert')}
      ${stat('RCs waiting', o.rc_pending ?? rcRows.length,
        'Registration certificates', 'stat--alert')}
      ${stat('Verified people', o.identity_verified ?? 0,
        `${o.identity_rejected ?? 0} rejected`, 'stat--good')}
      ${stat('People', o.users ?? 0, `${o.drivers ?? 0} drivers`)}
      ${stat('Vehicles', o.vehicles ?? 0, `${o.rides_active ?? 0} active rides`)}
      ${stat('Bookings', o.bookings ?? 0, `${o.bookings_confirmed ?? 0} confirmed`)}
      ${stat('Safety reports', o.safety_reports ?? 0, `${o.sos_incidents ?? 0} SOS`)}
    </div>

    <div class="section-head">
      <div><h2>Review queues</h2><p>Oldest submissions first — the person is blocked until a human decides.</p></div>
    </div>
    <div class="grid-stats">
      ${queueTile('Identity KYC', identityRows.length, '#/identity',
        'Rider and captain identity documents waiting')}
      ${queueTile('Vehicle KYC', vehicleRows.length, '#/vehicles',
        'DL + insurance packets waiting')}
      ${queueTile('RC review', rcRows.length, '#/rc',
        'Registration certificates waiting')}
    </div>

    <div class="section-head">
      <div><h2>Recent staff activity</h2><p>Every approval, rejection and role change is recorded.</p></div>
      <a class="btn btn--ghost btn--sm" href="#/audit">Open audit log</a>
    </div>
    ${auditTable(audit.data || [], true)}
  `;

  setRefresh(async () => {
    await renderOverview(root);
    await refreshCounts();
  });
}

function queueTile(title, count, href, hint) {
  return `<a class="card card--pad" href="${href}" style="text-decoration:none;color:inherit">
    <div class="flex items-center justify-between gap-12">
      <div>
        <div class="stat__label">${esc(title)}</div>
        <div class="stat__value" style="color:${count ? 'var(--warn)' : 'var(--success)'}">${esc(count)}</div>
        <div class="stat__hint">${esc(hint)}</div>
      </div>
      <span class="badge ${count ? 'badge--warn' : 'badge--success'}">
        ${count ? 'Needs review' : 'Clear'}
      </span>
    </div>
  </a>`;
}

/* ----------------------------------------------------------------- captain */
async function renderIdentity(root) {
  let status = 'submitted';
  root.innerHTML = `
    <div class="toolbar">
      <div class="segmented" id="idTabs">
        <button data-status="submitted" class="is-active">Waiting</button>
        <button data-status="verified">Verified</button>
        <button data-status="rejected">Rejected</button>
        <button data-status="unverified">Not started</button>
      </div>
      <span class="grow"></span>
      <button class="btn btn--ghost btn--sm" id="idReload" data-icon="refresh">Reload</button>
    </div>
    <p class="text-faint text-sm" style="margin:-6px 0 14px">
      Every identity is a human decision. A captain can publish once their
      identity and a vehicle packet are approved; a rider can book once their
      identity is approved. A rejection requires a reason the person can act on.
    </p>
    <div class="queue" id="idQueue">${skeletonCards(3)}</div>`;

  const queue = root.querySelector('#idQueue');

  const load = async () => {
    queue.innerHTML = skeletonCards(3);
    try {
      const data = await Api.identityQueue(status);
      const rows = data.queue || [];
      if (!rows.length) {
        queue.innerHTML = emptyState({
          title: status === 'submitted' ? 'No identities waiting' : 'Nothing in this state',
          desc: status === 'submitted'
            ? 'New rider and captain identity submissions appear here automatically.'
            : 'Choose another status to see other decisions.',
          ic: 'id',
        });
        return;
      }
      queue.innerHTML = rows.map(identityCard).join('');
      wireIdentityActions(queue, load);
    } catch (err) {
      queue.innerHTML = errorPanel(err);
    }
  };

  root.querySelectorAll('#idTabs button').forEach((button) => {
    button.addEventListener('click', () => {
      status = button.dataset.status;
      root.querySelectorAll('#idTabs button').forEach((b) =>
        b.classList.toggle('is-active', b === button));
      load();
    });
  });
  root.querySelector('#idReload').addEventListener('click', load);
  setRefresh(load);
  await load();
}

/* Backend roles are `driver` / `user`; reviewers think in captains and riders. */
function roleText(role) {
  if (role === 'driver') return 'captain';
  if (role === 'user' || role === 'passenger') return 'rider';
  return role || 'person';
}

function identityCard(item) {
  const state = item.kyc_status || 'unverified';
  const doc = item.document || {};
  const hasDoc = Boolean(doc.doc_id);
  const submittable = state === 'submitted';
  const canView = hasDoc;
  const reviewer = item.reviewer_id ? `Reviewer ${String(item.reviewer_id).slice(-6)}` : '';

  return `<article class="kyc-card">
    <div class="kyc-card__head">
      <span class="avatar avatar--lg">${esc(initials(item.name || item.email))}</span>
      <div class="kyc-card__who">
        <h3>${esc(item.name || 'Unnamed person')}</h3>
        <p>${esc(item.email || '')}${item.role ? ` · <span class="role-dot" data-role="${esc(item.role)}">${esc(roleText(item.role))}</span>` : ''}</p>
        <div class="flex gap-8 wrap mt-8">
          ${statusBadge(state)}
          ${hasDoc ? `<span class="badge badge--ghost">${icon('file', 12)} ${esc(DOC_TYPES[item.doc_type] || item.doc_type || 'Document')}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="kyc-card__meta">
      <div class="meta">Document number<b class="mono">${esc(item.doc_number_masked || '—')}</b></div>
      <div class="meta">Legal name<b>${esc(item.legal_name || '—')}</b></div>
      <div class="meta">Date of birth<b>${esc(item.date_of_birth || '—')}</b></div>
      <div class="meta">Submitted<b>${esc(fmtDateTime(item.submitted_at))}</b></div>
      <div class="meta">File<b>${esc(doc.content_type || 'not on file')}${doc.size ? ` · ${Math.round(doc.size / 1024)} KB` : ''}</b></div>
      ${item.reviewed_at ? `<div class="meta">Reviewed<b>${esc(fmtDateTime(item.reviewed_at))}${reviewer ? ` · ${esc(reviewer)}` : ''}</b></div>` : ''}
    </div>
    ${item.reason ? `<div class="note">${icon('alert', 14)} ${esc(item.reason)}</div>` : ''}
    <div class="kyc-card__foot">
      <div class="doc-chips">
        ${canView ? `<button class="doc-chip" data-doc="/api/kyc/admin/identity/${esc(item.user_id)}/document"
            data-doc-label="Identity document · ${esc(item.name || '')}">
            ${icon('eye', 14)} View identity document</button>` : '<span class="text-faint text-xs">No document on file</span>'}
      </div>
      <div class="kyc-card__actions">
        ${submittable ? `
          <button class="btn btn--ghost btn--sm" data-reject="${esc(item.user_id)}">Reject</button>
          <button class="btn btn--success btn--sm" data-approve="${esc(item.user_id)}">
            ${icon('check', 14)} Approve identity
          </button>` : `<span class="text-faint text-xs">${state === 'verified' ? 'Decision recorded' : 'No action available'}</span>`}
      </div>
    </div>
  </article>`;
}

function wireIdentityActions(scope, reload) {
  scope.querySelectorAll('[data-doc]').forEach((button) => {
    button.addEventListener('click', () =>
      viewDocument(button.dataset.doc, button.dataset.docLabel));
  });
  scope.querySelectorAll('[data-approve]').forEach((button) => {
    const row = button.closest('.kyc-card');
    const name = row?.querySelector('h3')?.textContent || 'this person';
    button.addEventListener('click', () => withBusy(button, 'Approving…', () => approve({
      title: 'Approve this identity?',
      message: `Approve the identity document for ${name}? This is recorded against your staff account. Captains still need an approved vehicle; riders can book as soon as the identity is approved.`,
      call: () => Api.reviewIdentity(button.dataset.approve, { decision: 'approve' }),
      success: 'Identity approved — the person has been notified.',
      reload,
    })));
  });
  scope.querySelectorAll('[data-reject]').forEach((button) => {
    const row = button.closest('.kyc-card');
    const name = row?.querySelector('h3')?.textContent || 'this person';
    button.addEventListener('click', () => reject({
      title: 'Reject this identity',
      subject: `${name} will see your reason and can upload a better document.`,
      call: (payload) => Api.reviewIdentity(button.dataset.reject,
        { decision: 'reject', reason: payload.reason, rejection_code: payload.rejection_code }),
      success: 'Identity rejected — the person has been notified.',
      reload,
    }));
  });
}

/* ----------------------------------------------------------------- vehicles */
async function renderVehicles(root) {
  root.innerHTML = `
    <div class="toolbar">
      <p class="text-faint text-sm grow" style="margin:0">
        A packet is ready only when the driving licence and insurance are both on file.
        Approval is per vehicle, not per captain.
      </p>
      <button class="btn btn--ghost btn--sm" id="vReload" data-icon="refresh">Reload</button>
    </div>
    <div class="queue" id="vQueue">${skeletonCards(3)}</div>
    <div id="vDrafts"></div>`;
  const queue = root.querySelector('#vQueue');
  const drafts = root.querySelector('#vDrafts');

  const load = async () => {
    queue.innerHTML = skeletonCards(3);
    drafts.innerHTML = '';
    try {
      // Drafts are a separate read-only list. Without them a captain who
      // uploaded one paper and stopped is completely invisible: the ready
      // queue only carries complete packets, which looks to the captain like
      // their vehicle never reached the console at all.
      const [ready, progress] = await Promise.all([
        Api.vehicleQueue(),
        Api.vehicleProgress().catch(() => ({ data: [] })),
      ]);
      const rows = ready.data || [];
      if (!rows.length) {
        queue.innerHTML = emptyState({
          title: 'No vehicle packets waiting',
          desc: 'Licence and insurance submissions appear here after a captain submits a vehicle.',
          ic: 'car',
        });
      } else {
        queue.innerHTML = rows.map(vehicleCard).join('');
        wireVehicleActions(queue, load, rows);
      }

      const readyIds = new Set(rows.map((row) => row.id));
      const draftRows = (progress.data || []).filter((row) => !readyIds.has(row.id));
      if (draftRows.length) {
        drafts.innerHTML = `
          <div class="section-head">
            <div>
              <h2>In progress</h2>
              <p>Papers uploaded, packet not complete. Open a card to correct the details or add a paper the captain sent you — a completed packet moves into the review queue above.</p>
            </div>
          </div>
          <div class="queue">${draftRows.map(vehicleDraftCard).join('')}</div>`;
        wireVehicleActions(drafts, load, draftRows);
      }
    } catch (err) {
      queue.innerHTML = errorPanel(err);
    }
  };

  root.querySelector('#vReload').addEventListener('click', load);
  setRefresh(load);
  await load();
}

function autoCheckBlock(auto) {
  if (!auto) {
    return `<p class="text-faint text-xs">No automated pre-check was run for this packet. Manual review is the only check.</p>`;
  }
  const map = {
    pass: ['badge--success', 'Auto-check passed'],
    fail: ['badge--danger', 'Auto-check found issues'],
    inconclusive: ['badge--warn', 'Auto-check inconclusive'],
    checking: ['badge--brand', 'Auto-check running'],
    unavailable: ['badge--warn', 'Auto-check unavailable'],
  };
  const [cls, label] = map[auto.status] || ['badge--ghost', 'Auto-check result'];
  const reasons = (auto.reasons || []).filter(Boolean);
  return `<div class="flex items-center gap-8 wrap mt-4">
      <span class="badge ${cls}">${icon('shield', 12)} ${esc(label)}</span>
      <span class="text-faint text-xs">advisory only</span>
    </div>
    ${reasons.length ? `<ul class="check-list mt-8">${reasons.map((r) =>
      `<li>${icon('alert', 13)}<span>${esc(r)}</span></li>`).join('')}</ul>` : ''}`;
}

function vehicleCard(item) {
  const docs = item.documents || {};
  return `<article class="kyc-card">
    <div class="kyc-card__head">
      <span class="avatar avatar--lg">${esc(initials(item.owner?.name || item.owner?.email))}</span>
      <div class="kyc-card__who">
        <h3>${esc(item.vehicle_model || 'Vehicle')} <span class="text-faint">· ${esc(item.vehicle_number || '')}</span></h3>
        <p>${esc(item.owner?.name || 'Unknown owner')} · ${esc(item.owner?.email || '')}${item.owner?.phone ? ` · ${esc(item.owner.phone)}` : ''}</p>
        <div class="flex gap-8 wrap mt-8">
          <span class="badge badge--brand">${icon('clock', 12)} In review</span>
          <span class="badge badge--ghost">${esc(item.vehicle_type || 'vehicle')}</span>
        </div>
      </div>
    </div>
    <div class="kyc-card__meta">
      <div class="meta">Licence number<b class="mono">${esc(item.dl_number || '—')}</b></div>
      <div class="meta">Insurance policy<b class="mono">${esc(item.insurance_number || '—')}</b></div>
      <div class="meta">Submitted<b>${esc(fmtDateTime(item.submitted_at))}</b></div>
      <div class="meta">Owner id<b class="mono">${esc(item.owner?.id || '—')}</b></div>
    </div>
    <div style="padding:0 20px 14px">
      ${autoCheckBlock(item.auto_check)}
    </div>
    <div class="kyc-card__foot">
      <div class="doc-chips">
        ${docs.dl
          ? `<button class="doc-chip" data-doc="${esc(docs.dl)}" data-doc-label="Driving licence · ${esc(item.vehicle_number || '')}">${icon('file', 14)} Licence</button>`
          : '<span class="badge badge--warn">Licence missing</span>'}
        ${docs.insurance
          ? `<button class="doc-chip" data-doc="${esc(docs.insurance)}" data-doc-label="Insurance · ${esc(item.vehicle_number || '')}">${icon('file', 14)} Insurance</button>`
          : '<span class="badge badge--warn">Insurance missing</span>'}
      </div>
      <div class="kyc-card__actions">
        <button class="btn btn--ghost btn--sm" data-reject="${esc(item.id)}">Reject</button>
        <button class="btn btn--success btn--sm" data-approve="${esc(item.id)}">
          ${icon('check', 14)} Approve vehicle
        </button>
      </div>
    </div>
  </article>`;
}

function vehicleDraftCard(item) {
  const docs = item.documents || {};
  const missing = item.missing || [];
  return `<article class="kyc-card">
    <div class="kyc-card__head">
      <span class="avatar avatar--lg">${esc(initials(item.owner?.name || item.owner?.email))}</span>
      <div class="kyc-card__who">
        <h3>${esc(item.vehicle_model || 'Vehicle')} <span class="text-faint">· ${esc(item.vehicle_number || '')}</span></h3>
        <p>${esc(item.owner?.name || 'Unknown owner')} · ${esc(item.owner?.email || '')}${item.owner?.phone ? ` · ${esc(item.owner.phone)}` : ''}</p>
        <div class="flex gap-8 wrap mt-8">
          <span class="badge badge--warn">${icon('clock', 12)} Waiting on documents</span>
          <span class="badge badge--ghost">${esc(item.vehicle_type || 'vehicle')}</span>
        </div>
      </div>
    </div>
    <div class="kyc-card__meta">
      <div class="meta">Still needed<b>${esc(missing.join(', ') || '—')}</b></div>
      <div class="meta">Status<b>${esc(item.verification_status || 'unverified')}</b></div>
      <div class="meta">Last update<b>${esc(fmtDateTime(item.updated_at))}</b></div>
      <div class="meta">Owner id<b class="mono">${esc(item.owner?.id || '—')}</b></div>
    </div>
    <div class="kyc-card__foot">
      <div class="doc-chips">
        ${docs.dl
          ? `<button class="doc-chip" data-doc="${esc(docs.dl)}" data-doc-label="Driving licence · ${esc(item.vehicle_number || '')}">${icon('file', 14)} Licence</button>`
          : '<span class="badge badge--ghost">No licence yet</span>'}
        ${docs.insurance
          ? `<button class="doc-chip" data-doc="${esc(docs.insurance)}" data-doc-label="Insurance · ${esc(item.vehicle_number || '')}">${icon('file', 14)} Insurance</button>`
          : '<span class="badge badge--ghost">No insurance yet</span>'}
        ${docs.rc
          ? `<button class="doc-chip" data-doc="${esc(docs.rc)}" data-doc-label="Registration certificate · ${esc(item.vehicle_number || '')}">${icon('file', 14)} RC</button>`
          : ''}
      </div>
      <div class="kyc-card__actions">
        <button class="btn btn--primary btn--sm" data-edit-vehicle="${esc(item.id)}">
          ${icon('edit', 14)} Edit / add papers
        </button>
      </div>
    </div>
  </article>`;
}

function editVehicleModal(item, reload) {
  const docs = item.documents || {};
  const types = ['2-wheeler', '4-wheeler', 'auto', 'bus'];
  const { el, close } = openModal({
    title: `Edit ${item.vehicle_model || 'vehicle'} · ${item.vehicle_number || ''}`,
    subtitle: 'Changes are recorded against your staff account. Editing an identity field or replacing a paper re-opens review.',
    lg: true,
    body: `
      <div class="grid-2">
        <div class="field"><label for="evNumber">Registration number</label>
          <input class="input" id="evNumber" value="${esc(item.vehicle_number || '')}" /></div>
        <div class="field"><label for="evModel">Model</label>
          <input class="input" id="evModel" value="${esc(item.vehicle_model || '')}" /></div>
      </div>
      <div class="grid-2 mt-12">
        <div class="field"><label for="evType">Vehicle type</label>
          <select class="select" id="evType">
            ${types.map((t) => `<option value="${t}" ${item.vehicle_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="evSeats">Seats</label>
          <input class="input" id="evSeats" type="number" min="1" max="24" value="${item.seat_count ?? ''}" /></div>
      </div>
      <div class="grid-2 mt-12">
        <div class="field"><label for="evDl">Driving licence no.</label>
          <input class="input" id="evDl" value="${esc(item.dl_number || '')}" placeholder="Not recorded" /></div>
        <div class="field"><label for="evInsurance">Insurance policy no.</label>
          <input class="input" id="evInsurance" value="${esc(item.insurance_number || '')}" placeholder="Not recorded" /></div>
      </div>
      <div class="grid-2 mt-12">
        <div class="field"><label for="evDlDoc">Licence photo</label>
          <input class="input" id="evDlDoc" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" />
          <p class="field__hint">${docs.dl ? 'On file — choosing a file replaces it.' : 'Missing.'}</p></div>
        <div class="field"><label for="evInsDoc">Insurance photo</label>
          <input class="input" id="evInsDoc" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" />
          <p class="field__hint">${docs.insurance ? 'On file — choosing a file replaces it.' : 'Missing.'}</p></div>
      </div>
      <p class="field__hint mt-12">Only files the captain has actually supplied. Uploading here records your staff account as the sender.</p>`,
    foot: `<button class="btn btn--ghost" data-cancel>Cancel</button>
           <button class="btn btn--primary" data-save>Save changes</button>`,
  });

  const field = (id) => el.querySelector(`#${id}`).value.trim();
  const file = (id) => el.querySelector(`#${id}`).files?.[0] || null;
  el.querySelector('[data-cancel]').addEventListener('click', close);

  el.querySelector('[data-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const payload = {
        vehicle_number: field('evNumber'),
        vehicle_model: field('evModel'),
        vehicle_type: el.querySelector('#evType').value,
        seat_count: Number(field('evSeats')) || undefined,
        dl_number: field('evDl'),
        insurance_number: field('evInsurance'),
      };
      const updated = await Api.updateVehicle(item.id, payload);
      let submitted = updated.submitted;
      let last = updated;
      for (const [kind, id] of [['dl', 'evDlDoc'], ['insurance', 'evInsDoc']]) {
        const chosen = file(id);
        if (!chosen) continue;
        last = await Api.uploadVehicleDoc(item.id, kind, chosen);
        submitted = submitted || last.submitted;
      }
      close();
      const missing = last.missing || [];
      if (submitted) {
        toast('Packet complete — moved to the review queue above.', 'success', 6000);
      } else if (missing.length) {
        toast(`Saved. Still needed: ${missing.join(', ')}.`, 'success', 6000);
      } else {
        // Complete but not forwarded (e.g. the automated check needs the
        // captain's consent). Say so instead of a cheerful no-op.
        toast('Saved. The packet is complete but was not forwarded — the captain still has to submit it.', 'error', 7000);
      }
      await reload();
      refreshCounts();
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Save changes';
      toast(err.message || 'The changes could not be saved.', 'error', 6000);
    }
  });
}

function wireVehicleActions(scope, reload, rows = []) {
  scope.querySelectorAll('[data-doc]').forEach((button) => {
    button.addEventListener('click', () =>
      viewDocument(button.dataset.doc, button.dataset.docLabel));
  });
  scope.querySelectorAll('[data-edit-vehicle]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = rows.find((row) => String(row.id) === String(button.dataset.editVehicle));
      if (!item) { toast('Reload the list and try again.', 'error'); return; }
      editVehicleModal(item, reload);
    });
  });
  scope.querySelectorAll('[data-approve]').forEach((button) => {
    const row = button.closest('.kyc-card');
    const vehicle = row?.querySelector('h3')?.textContent?.trim() || 'this vehicle';
    button.addEventListener('click', () => withBusy(button, 'Approving…', () => approve({
      title: 'Approve this vehicle packet?',
      message: `Approve ${vehicle}? The captain can publish with this vehicle once their identity is also verified.`,
      call: () => Api.reviewVehicle(button.dataset.approve, { decision: 'approve' }),
      success: 'Vehicle packet approved.',
      reload,
    })));
  });
  scope.querySelectorAll('[data-reject]').forEach((button) => {
    const row = button.closest('.kyc-card');
    const vehicle = row?.querySelector('h3')?.textContent?.trim() || 'this vehicle';
    button.addEventListener('click', () => reject({
      title: 'Reject this vehicle packet',
      subject: `${vehicle}: the owner sees this note and can resubmit corrected papers.`,
      call: (payload) => Api.reviewVehicle(button.dataset.reject,
        { decision: 'reject', reason: payload.reason }),
      success: 'Vehicle packet rejected — the owner has been notified.',
      reload,
    }));
  });
}

/* ---------------------------------------------------------------------- RC */
async function renderRc(root) {
  root.innerHTML = `
    <div class="toolbar">
      <p class="text-faint text-sm grow" style="margin:0">
        The registration certificate is checked separately from the licence/insurance
        packet. A vehicle needs both an approved RC and an approved packet to publish.
      </p>
      <button class="btn btn--ghost btn--sm" id="rcReload" data-icon="refresh">Reload</button>
    </div>
    <div class="queue" id="rcQueue">${skeletonCards(3)}</div>`;
  const queue = root.querySelector('#rcQueue');

  const load = async () => {
    queue.innerHTML = skeletonCards(3);
    try {
      const data = await Api.rcQueue();
      const rows = data.queue || [];
      if (!rows.length) {
        queue.innerHTML = emptyState({
          title: 'No registration certificates waiting',
          desc: 'RC uploads from captains appear here for manual review.',
          ic: 'file',
        });
        return;
      }
      queue.innerHTML = rows.map(rcCard).join('');
      wireRcActions(queue, load);
    } catch (err) {
      queue.innerHTML = errorPanel(err);
    }
  };

  root.querySelector('#rcReload').addEventListener('click', load);
  setRefresh(load);
  await load();
}

function rcCard(item) {
  return `<article class="kyc-card">
    <div class="kyc-card__head">
      <span class="avatar avatar--lg">${esc(initials(item.owner?.name || item.vehicle_number))}</span>
      <div class="kyc-card__who">
        <h3>${esc(item.vehicle_number || 'Vehicle')}</h3>
        <p>${esc(item.owner?.name || 'Unknown owner')} · ${esc(item.owner?.email || '')}${item.owner?.phone ? ` · ${esc(item.owner.phone)}` : ''}</p>
        <div class="flex gap-8 wrap mt-8">
          <span class="badge badge--brand">${icon('clock', 12)} RC in review</span>
          <span class="badge badge--ghost mono">${esc(item.rc_number_masked || 'number masked')}</span>
        </div>
      </div>
    </div>
    <div class="kyc-card__meta">
      <div class="meta">Submitted<b>${esc(fmtDateTime(item.submitted_at))}</b></div>
      <div class="meta">Vehicle id<b class="mono">${esc(item.vehicle_id || '—')}</b></div>
      <div class="meta">Owner id<b class="mono">${esc(item.user_id || '—')}</b></div>
      <div class="meta">File<b>${esc(item.document?.content_type || 'not on file')}${item.document?.size ? ` · ${Math.round(item.document.size / 1024)} KB` : ''}</b></div>
    </div>
    ${item.reason ? `<div class="note">${icon('alert', 14)} ${esc(item.reason)}</div>` : ''}
    <div class="kyc-card__foot">
      <div class="doc-chips">
        <button class="doc-chip" data-doc="/api/kyc/vehicles/${esc(item.vehicle_id)}/rc/document"
          data-doc-label="Registration certificate · ${esc(item.vehicle_number || '')}">
          ${icon('eye', 14)} View RC document</button>
      </div>
      <div class="kyc-card__actions">
        <button class="btn btn--ghost btn--sm" data-reject="${esc(item.vehicle_id)}">Reject</button>
        <button class="btn btn--success btn--sm" data-approve="${esc(item.vehicle_id)}">
          ${icon('check', 14)} Approve RC
        </button>
      </div>
    </div>
  </article>`;
}

function wireRcActions(scope, reload) {
  scope.querySelectorAll('[data-doc]').forEach((button) => {
    button.addEventListener('click', () =>
      viewDocument(button.dataset.doc, button.dataset.docLabel));
  });
  scope.querySelectorAll('[data-approve]').forEach((button) => {
    const row = button.closest('.kyc-card');
    const vehicle = row?.querySelector('h3')?.textContent?.trim() || 'this vehicle';
    button.addEventListener('click', () => withBusy(button, 'Approving…', () => approve({
      title: 'Approve this registration certificate?',
      message: `Approve the RC for ${vehicle}? Replacing the document later reopens review automatically.`,
      call: () => Api.reviewRc(button.dataset.approve, { decision: 'approve' }),
      success: 'Registration certificate approved.',
      reload,
    })));
  });
  scope.querySelectorAll('[data-reject]').forEach((button) => {
    const row = button.closest('.kyc-card');
    const vehicle = row?.querySelector('h3')?.textContent?.trim() || 'this vehicle';
    button.addEventListener('click', () => reject({
      title: 'Reject this registration certificate',
      subject: `${vehicle}: the owner sees this note and can upload a clearer RC.`,
      call: (payload) => Api.reviewRc(button.dataset.reject,
        { decision: 'reject', reason: payload.reason }),
      success: 'Registration certificate rejected — the owner has been notified.',
      reload,
    }));
  });
}

/* ------------------------------------------------------------------- users */
async function renderUsers(root) {
  const state = { q: '', role: '', kyc: '', page: 1, limit: 25 };
  document.getElementById('pageEyebrow').textContent = 'Directory & roles';

  root.innerHTML = `
    <div class="toolbar">
      <form class="searchbar" id="userSearch">
        ${icon('search', 16)}
        <input class="input" name="q" placeholder="Search name, email or phone…"
               autocomplete="off" aria-label="Search people" />
      </form>
      <select class="select" id="roleFilter" aria-label="Filter by role">
        <option value="">All roles</option>
        <option value="user">Passengers</option>
        <option value="driver">Captains</option>
        <option value="support">Support</option>
        <option value="admin">Admins</option>
      </select>
      <select class="select" id="kycFilter" aria-label="Filter by identity status">
        <option value="">Any identity status</option>
        <option value="submitted">Identity in review</option>
        <option value="verified">Identity verified</option>
        <option value="rejected">Identity rejected</option>
        <option value="unverified">Identity not started</option>
      </select>
      <button class="btn btn--ghost btn--sm" id="userReload" data-icon="refresh">Reload</button>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Person</th><th>Role</th><th>Identity</th><th>Driver docs</th>
          <th>Joined</th><th>Manage</th>
        </tr></thead>
        <tbody id="userRows"><tr><td colspan="6"><div class="page-loading">
          <span class="spinner"></span> Loading people…</div></td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="userPager"></div>`;

  const rowsEl = root.querySelector('#userRows');
  const pager = root.querySelector('#userPager');

  const load = async () => {
    rowsEl.innerHTML = `<tr><td colspan="6"><div class="page-loading">
      <span class="spinner"></span> Loading people…</div></td></tr>`;
    try {
      const data = await Api.users({
        q: state.q, role: state.role, kyc_status: state.kyc,
        page: state.page, limit: state.limit,
      });
      const rows = data.data || [];
      if (!rows.length) {
        rowsEl.innerHTML = `<tr><td colspan="6">${emptyState({
          title: 'No matching people',
          desc: 'Try a different search, role or identity status.',
          ic: 'users',
        })}</td></tr>`;
      } else {
        rowsEl.innerHTML = rows.map(userRow).join('');
        wireUserRows(rowsEl, rows, load);
      }
      pager.innerHTML = `
        <span>${esc(data.total || 0)} people · page ${esc(data.page || 1)} of ${esc(data.pages || 1)}</span>
        <span class="flex gap-8">
          <button class="btn btn--ghost btn--sm" data-page="${Number(data.page || 1) - 1}"
            ${Number(data.page || 1) <= 1 ? 'disabled' : ''}>${icon('left', 14)} Previous</button>
          <button class="btn btn--ghost btn--sm" data-page="${Number(data.page || 1) + 1}"
            ${Number(data.page || 1) >= Number(data.pages || 1) ? 'disabled' : ''}>Next ${icon('right', 14)}</button>
        </span>`;
      pager.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => {
          state.page = Number(button.dataset.page);
          load();
        });
      });
    } catch (err) {
      rowsEl.innerHTML = `<tr><td colspan="6">${errorPanel(err)}</td></tr>`;
    }
  };

  const search = root.querySelector('#userSearch');
  search.addEventListener('submit', (event) => {
    event.preventDefault();
    state.q = search.elements.q.value.trim();
    state.page = 1;
    load();
  });
  let typing = null;
  search.elements.q.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.q = search.elements.q.value.trim();
      state.page = 1;
      load();
    }, 350);
  });
  root.querySelector('#roleFilter').addEventListener('change', (event) => {
    state.role = event.target.value; state.page = 1; load();
  });
  root.querySelector('#kycFilter').addEventListener('change', (event) => {
    state.kyc = event.target.value; state.page = 1; load();
  });
  root.querySelector('#userReload').addEventListener('click', load);
  setRefresh(load);
  await load();
}

function userRow(user) {
  const isSelf = user.id === app.user?.id;
  const identity = user.kyc_status || 'unverified';
  const staffOptions = app.user?.role === 'admin'
    ? ['user', 'driver', 'admin', 'support']
    : ['user', 'driver'];
  const roleOptions = staffOptions.map((role) =>
    `<option value="${role}" ${user.role === role ? 'selected' : ''}>${role}</option>`).join('');

  return `<tr data-uid="${esc(user.id)}">
    <td>
      <div class="person">
        <span class="avatar">${esc(initials(user.name || user.email))}</span>
        <span class="person__text">
          <b>${esc(user.name || 'Unnamed')}${isSelf ? ' <span class="text-faint">(you)</span>' : ''}</b>
          <small>${esc(user.email || '')}${user.phone ? ` · ${esc(user.phone)}` : ''}</small>
        </span>
      </div>
    </td>
    <td>
      ${isSelf
        ? `<span class="role-dot" data-role="${esc(user.role)}">${esc(roleText(user.role))}</span>`
        : `<select class="select" data-role-select style="min-width:112px">${roleOptions}</select>`}
    </td>
    <td>${statusBadge(identity)}
      ${user.kyc_reason ? `<div class="text-faint text-xs" style="max-width:220px">${esc(user.kyc_reason)}</div>` : ''}
    </td>
    <td>
      <div class="flex gap-8 wrap">
        <span class="badge ${user.licence_verified ? 'badge--success' : 'badge--ghost'}">Licence ${user.licence_verified ? '✓' : '—'}</span>
        <span class="badge ${user.insurance_verified ? 'badge--success' : 'badge--ghost'}">Insurance ${user.insurance_verified ? '✓' : '—'}</span>
      </div>
    </td>
    <td class="text-sm text-muted nowrap">${esc(fmtDate(user.created_at))}</td>
    <td>
      <div class="table-actions">
        <button class="btn btn--ghost btn--sm" data-verify="licence"
          data-approved="${user.licence_verified ? 'false' : 'true'}">
          ${user.licence_verified ? 'Unverify licence' : 'Verify licence'}</button>
        <button class="btn btn--ghost btn--sm" data-verify="insurance"
          data-approved="${user.insurance_verified ? 'false' : 'true'}">
          ${user.insurance_verified ? 'Unverify insurance' : 'Verify insurance'}</button>
      </div>
    </td>
  </tr>`;
}

function wireUserRows(scope, users, reload) {
  scope.querySelectorAll('tr[data-uid]').forEach((row) => {
    const uid = row.dataset.uid;
    const user = users.find((u) => u.id === uid);
    if (!user) return;

    const roleSelect = row.querySelector('[data-role-select]');
    if (roleSelect) {
      roleSelect.addEventListener('change', async () => {
        const role = roleSelect.value;
        if (role === user.role) return;
        const staff = role === 'admin' || role === 'support';
        const ok = await confirmDialog({
          title: `Change role to ${role}?`,
          message: staff
            ? `${user.name || user.email} will get staff access. ${role === 'admin'
              ? 'Admins can review documents and grant staff roles.'
              : 'Support can review documents but cannot grant staff roles.'}`
            : `${user.name || user.email} will become a ${role}.`,
          confirmLabel: 'Change role',
          danger: staff,
        });
        if (!ok) { roleSelect.value = user.role; return; }
        roleSelect.disabled = true;
        try {
          await Api.setRole(uid, role);
          toast(`Role updated to ${role}.`, 'success');
          await reload();
        } catch (err) {
          roleSelect.value = user.role;
          toast(err.message || 'Role change failed.', 'error', 6000);
        } finally {
          roleSelect.disabled = false;
        }
      });
    }

    row.querySelectorAll('[data-verify]').forEach((button) => {
      button.addEventListener('click', async () => {
        const kind = button.dataset.verify;
        const approved = button.dataset.approved === 'true';
        const ok = await confirmDialog({
          title: `${approved ? 'Verify' : 'Unverify'} ${kind}?`,
          message: `${approved ? 'Mark' : 'Remove'} the ${kind} flag for ${user.name || user.email}?
            This legacy flag is separate from identity KYC and is recorded in the audit log.`,
          confirmLabel: approved ? 'Verify' : 'Unverify',
          danger: !approved,
        });
        if (!ok) return;
        await withBusy(button, 'Saving…', async () => {
          try {
            await Api.verifyUser(uid, kind, approved);
            toast(`${kind} ${approved ? 'verified' : 'unverified'}.`, 'success');
            await reload();
          } catch (err) {
            toast(err.message || 'Update failed.', 'error', 6000);
          }
        });
      });
    });
  });
}

/* ------------------------------------------------------------------- audit */
async function renderAudit(root) {
  const state = { action: '', page: 1 };
  root.innerHTML = `
    <div class="toolbar">
      <form class="searchbar" id="auditFilter">
        ${icon('search', 16)}
        <input class="input" name="action" placeholder="Filter by exact action, e.g. identity.vehicle.verify"
               autocomplete="off" aria-label="Filter audit action" />
      </form>
      <button class="btn btn--ghost btn--sm" id="auditReload" data-icon="refresh">Reload</button>
    </div>
    <p class="text-faint text-sm" style="margin:-6px 0 14px">
      Reviewer decisions, document reads, role changes and payout actions are all
      appended here. The log is read-only.
    </p>
    <div id="auditTable">${auditTable([], false)}</div>
    <div class="pagination" id="auditPager"></div>`;

  const holder = root.querySelector('#auditTable');
  const pager = root.querySelector('#auditPager');

  const load = async () => {
    holder.innerHTML = '<div class="page-loading"><span class="spinner"></span> Loading audit log…</div>';
    try {
      const data = await Api.audit({ action: state.action, page: state.page, limit: 50 });
      holder.innerHTML = auditTable(data.data || [], false);
      pager.innerHTML = `
        <span>${esc(data.total || 0)} entries · page ${esc(data.page || 1)}</span>
        <span class="flex gap-8">
          <button class="btn btn--ghost btn--sm" data-page="${Number(data.page || 1) - 1}"
            ${Number(data.page || 1) <= 1 ? 'disabled' : ''}>${icon('left', 14)} Previous</button>
          <button class="btn btn--ghost btn--sm" data-page="${Number(data.page || 1) + 1}"
            ${(data.data || []).length < 50 ? 'disabled' : ''}>Next ${icon('right', 14)}</button>
        </span>`;
      pager.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => {
          state.page = Number(button.dataset.page);
          load();
        });
      });
    } catch (err) {
      holder.innerHTML = errorPanel(err);
    }
  };

  const form = root.querySelector('#auditFilter');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.action = form.elements.action.value.trim();
    state.page = 1;
    load();
  });
  root.querySelector('#auditReload').addEventListener('click', load);
  setRefresh(load);
  await load();
}

function auditTable(rows, compact) {
  if (!rows.length) {
    return emptyState({
      title: 'No audit entries yet',
      desc: 'Approvals, rejections and staff actions will appear here.',
      ic: 'history',
    });
  }
  return `<div class="table-wrap">
    <table class="data">
      <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Detail</th></tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>
          <td class="text-sm text-muted nowrap" title="${esc(fmtDateTime(row.created_at))}">
            ${esc(timeAgo(row.created_at))}</td>
          <td><span class="badge badge--ghost mono">${esc(row.action || '—')}</span></td>
          <td class="mono text-xs">${esc(shortId(row.actor_id))}</td>
          <td class="text-sm">${esc(row.target_type || '—')}<br>
            <span class="text-faint mono text-xs">${esc(shortId(row.target_id))}</span></td>
          <td class="text-sm text-muted" style="max-width:360px">
            ${row.reason ? `<div>${esc(row.reason)}</div>` : ''}
            ${row.meta && Object.keys(row.meta).length
              ? `<details><summary class="text-xs text-faint" style="cursor:pointer">metadata</summary>
                  <pre class="mono text-xs" style="white-space:pre-wrap;margin:6px 0 0">${esc(JSON.stringify(row.meta, null, 2))}</pre></details>`
              : '<span class="text-faint">—</span>'}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>${compact ? '' : ''}`;
}

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 12 ? `…${text.slice(-8)}` : text;
}
