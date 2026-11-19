/* API client for the standalone maintenance console.
 *
 * Security posture mirrors the rider app:
 *  - the access token lives ONLY in memory; a page load rehydrates it from the
 *    HttpOnly refresh cookie (never from localStorage);
 *  - the refresh token is a cookie the JavaScript cannot read;
 *  - every staff endpoint is also RBAC-checked server-side, so this UI is a
 *    convenience gate, not the security boundary.
 */

const API_STORE_KEY = 'rm_maint_api';
const AUTH_MARKER = 'rm_maint_authed';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/* This console is deployed as a Render static site, which cannot run Flask or
   reach MongoDB. Production must call the backend web service instead of the
   page's own origin; localhost still talks to the local API. */
const DEPLOYED_API_BASE = 'https://ridemate-k2hu.onrender.com';

export class ApiError extends Error {
  constructor(message, status = 0, code = 'error', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function defaultApiBase() {
  // Opening index.html straight from disk (file://) has no usable origin.
  if (window.location.protocol === 'file:') return 'http://localhost:5000';
  if (LOCAL_HOSTS.has(window.location.hostname)) return 'http://localhost:5000';
  // A static site has no API routes of its own, so use the live Render backend.
  return DEPLOYED_API_BASE;
}

export function getApiBase() {
  const saved = localStorage.getItem(API_STORE_KEY);
  return (saved || defaultApiBase()).replace(/\/+$/, '');
}

export function setApiBase(value) {
  const clean = String(value || '').trim().replace(/\/+$/, '');
  if (!clean) localStorage.removeItem(API_STORE_KEY);
  else localStorage.setItem(API_STORE_KEY, clean);
  return getApiBase();
}

/* ------------------------------------------------------------------ session */
let _token = '';

export const session = {
  get token() { return _token; },
  get user() { return _user; },
  get hadSession() { return localStorage.getItem(AUTH_MARKER) === '1'; },
  save(token, user) {
    _token = token || '';
    _user = user || null;
    if (_token) localStorage.setItem(AUTH_MARKER, '1');
  },
  clear() {
    _token = '';
    _user = null;
    localStorage.removeItem(AUTH_MARKER);
  },
};

let _user = null;
let _refreshing = null;

function isAuthPath(path) {
  return path.startsWith('/api/auth/');
}

async function refreshAccessToken() {
  if (!_refreshing) {
    _refreshing = (async () => {
      let res;
      try {
        res = await fetch(`${getApiBase()}/api/auth/refresh`, {
          method: 'POST', credentials: 'include',
        });
      } catch {
        throw new ApiError('Cannot reach the RideMate API.', 0, 'network');
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (data && data.error) || {};
        throw new ApiError(err.message || 'Session expired. Please sign in again.',
          res.status, err.code);
      }
      session.save(data.token, data.user);
      return data;
    })().finally(() => { _refreshing = null; });
  }
  return _refreshing;
}

async function request(method, path, { body, form, retried = false } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const opts = { method, headers, credentials: 'include' };
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${getApiBase()}${path}`, opts);
  } catch {
    throw new ApiError(
      `Cannot reach ${getApiBase()}. Is the backend running and is this origin in FRONTEND_ORIGINS?`,
      0, 'network');
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    const err = (data && data.error) || {};
    if (res.status === 401 && !isAuthPath(path) && !retried) {
      try {
        await refreshAccessToken();
        return request(method, path, { body, form, retried: true });
      } catch { /* fall through to logout */ }
    }
    if (res.status === 401 && !isAuthPath(path)) {
      session.clear();
      window.dispatchEvent(new CustomEvent('maint:logout'));
    }
    throw new ApiError(err.message || `Request failed (${res.status})`,
      res.status, err.code, err.details);
  }
  return data;
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, { body: b === undefined ? {} : b });
const patch = (p, b) => request('PATCH', p, { body: b });

/* --------------------------------------------------------------- endpoints */
export const Api = {
  login(email, password) {
    return post('/api/auth/login', { email, password });
  },
  async restore() {
    if (!session.token && session.hadSession) {
      await refreshAccessToken();
    }
    if (!session.token) throw new ApiError('No session.', 401, 'auth_required');
    const data = await get('/api/auth/me');
    session.save(session.token, data.user);
    return data.user;
  },
  async logout() {
    try { await post('/api/auth/logout'); } catch { /* clear locally anyway */ }
    session.clear();
  },

  overview: () => get('/api/admin/overview'),
  analytics: () => get('/api/admin/analytics'),

  users: ({ role = '', kyc_status = '', q = '', page = 1, limit = 25 } = {}) => {
    const qs = new URLSearchParams();
    if (role) qs.set('role', role);
    if (kyc_status) qs.set('kyc_status', kyc_status);
    if (q) qs.set('q', q);
    qs.set('page', String(page));
    qs.set('limit', String(limit));
    return get(`/api/admin/users?${qs}`);
  },
  setRole: (uid, role) => patch(`/api/admin/users/${uid}/role`, { role }),
  verifyUser: (uid, kind, approved) =>
    post(`/api/admin/users/${uid}/verify`, { kind, approved }),

  identityQueue: (status = 'submitted') =>
    get(`/api/kyc/admin/identity/queue?status=${encodeURIComponent(status)}&limit=100`),
  reviewIdentity: (uid, payload) =>
    post(`/api/kyc/admin/identity/${uid}/review`, payload),

  vehicleQueue: () => get('/api/admin/vehicles/pending'),
  vehicleProgress: () => get('/api/admin/vehicles/progress'),
  reviewVehicle: (vid, payload) => post(`/api/admin/vehicles/${vid}/verify`, payload),
  updateVehicle: (vid, payload) => patch(`/api/admin/vehicles/${vid}`, payload),
  uploadVehicleDoc(vid, kind, file) {
    const form = new FormData();
    form.append('doc', kind);
    form.append('file', file);
    return request('POST', `/api/admin/vehicles/${vid}/document`, { form });
  },

  rcQueue: () => get('/api/kyc/admin/rc/queue'),
  reviewRc: (vid, payload) =>
    post(`/api/kyc/admin/vehicles/${vid}/rc/review`, payload),

  audit: ({ action = '', page = 1, limit = 50 } = {}) => {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (action) qs.set('action', action);
    return get(`/api/admin/audit?${qs}`);
  },

  /* Private documents are fetched with the bearer token and turned into an
     object URL by the caller; they are never linked directly, so the token
     cannot leak into a URL, history entry or referrer. */
  async document(path) {
    const url = path.startsWith('http') ? path : `${getApiBase()}${path}`;
    const run = () => fetch(url, {
      headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
      credentials: 'include',
    });
    let res = await run();
    if (res.status === 401) {
      await refreshAccessToken();
      res = await run();
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = (data && data.error) || {};
      throw new ApiError(err.message || `Could not load the document (${res.status}).`,
        res.status, err.code);
    }
    return {
      blob: await res.blob(),
      type: res.headers.get('content-type') || 'application/octet-stream',
    };
  },
};
