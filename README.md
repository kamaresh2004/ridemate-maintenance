# RideMate · Captain Maintenance

A standalone staff console for the RideMate backend. It is deliberately a
separate app from the rider/driver SPA: reviewers sign in with an **admin** or
**support** account, work the identity, vehicle and RC review queues, and every
decision is written to the main RideMate audit log.

Two gates depend on this console. A **captain** (driver) can publish only once
an admin has approved both their identity and a vehicle packet; a **rider**
(passenger) can book only once an admin has approved their identity. Documents
are always uploaded by the person themselves in RideMate — this console only
reads them and records a decision. There is no self-approval path anywhere.

Nothing here is a second backend. The console talks to the existing Flask API
(`/api/...`) and never stores identities, documents or passwords locally.

```
Browser (this app)  ──HTTPS/JSON──▶  RideMate Flask API  ──▶  MongoDB + private document store
        │                                   │
        └── access token in memory          └── admin/support RBAC on every route
            refresh cookie (HttpOnly)           audit rows for every decision
```

## What it does

| Screen | Purpose | API |
| --- | --- | --- |
| Overview | Queue sizes, verified/rejected totals, recent staff activity | `GET /api/admin/overview`, queues, `GET /api/admin/audit` |
| Identity KYC | Read a **rider's or captain's** identity document (submitted from RideMate → Profile / Captain), then approve or reject with a reason | `GET /api/kyc/admin/identity/queue`, `GET /api/kyc/admin/identity/<uid>/document`, `POST /api/kyc/admin/identity/<uid>/review` |
| Vehicle KYC | Review a submitted driving-licence + insurance packet, including the advisory auto-check | `GET /api/admin/vehicles/pending`, `POST /api/admin/vehicles/<vid>/verify` |
| RC review | Review the registration certificate separately from the packet | `GET /api/kyc/admin/rc/queue`, `GET /api/kyc/admin/vehicles/<vid>/rc/document`, `POST /api/kyc/admin/vehicles/<vid>/rc/review` |
| People | Search users, change roles (admin only), toggle legacy licence/insurance flags | `GET /api/admin/users`, `PATCH /api/admin/users/<uid>/role`, `POST /api/admin/users/<uid>/verify` |
| Audit log | Read-only trail of staff decisions and document reads | `GET /api/admin/audit` |

Approval is never self-service: the console only sends `decision: "approve"` or
`decision: "reject"`. The backend state machine is what actually moves a person
from `submitted` to `verified`, and a rejection without a reason is refused
server-side. The rider's Profile panel polls `GET /api/kyc/me`, so it flips to
"Verified" on its own a few seconds after you approve — no reload needed.

## Run it

1. Start the RideMate backend (from the main project):

   ```powershell
   cd "D:\car pooling\carpooling-main\carpooling-main"
   $env:MONGO_URI="mongodb://localhost:27017"
   $env:MONGO_DB_NAME="ridemate"
   $env:PAYMENT_PROVIDER="demo"
   $env:FLASK_ENV="development"
   $env:JWT_SECRET="local-dev-only-secret-0123456789abcdef"
   $env:PORT="5000"
   .\.venv\Scripts\python.exe -m backend.app
   ```

   Or simply `.\start-local.ps1` from the project root, which pins exactly these
   values. The database name **`ridemate`** is the one that holds the seeded
   demo accounts — using another name is what makes demo logins fail with
   *Invalid email or password*.

2. Start this app:

   ```powershell
   .\start.ps1
   ```

   Or double-click `start.cmd`. It serves the folder at
   **http://localhost:5600** with no build step and no npm dependencies.

3. Sign in with an **admin** or **support** account. The API base defaults to
   `http://localhost:5000` on localhost and is editable under
   *Backend connection* on the sign-in screen.

## Create the first staff account

Registration creates a normal `user` (correctly — nobody self-declares a staff
role). Promote an existing account once, directly in MongoDB:

```powershell
mongosh "mongodb://localhost:27017/ridemate_dev" --eval `
  'db.users.updateOne({email:"you@example.com"}, {$set:{role:"admin"}})'
```

For a remote/Atlas database use its connection string instead. Role is read
from the database on every request, so no re-login is needed after the update.

Alternatively promote through the API using any existing admin:

```powershell
curl -X PATCH http://localhost:5000/api/admin/users/<user-id>/role ^
  -H "Authorization: Bearer <admin-access-token>" ^
  -H "Content-Type: application/json" ^
  -d "{\"role\":\"admin\"}"
```

## Connecting to the backend (CORS and cookies)

This app is served from port **5600**, so the backend must allow that origin.
The main project already includes it in the development defaults and in
`backend/.env` / `backend/.env.example`:

```
FRONTEND_ORIGINS=http://localhost:5000,http://localhost:5500,http://localhost:8000,http://localhost:5600,http://127.0.0.1:5600
```

Restart Flask after changing it. If you see *"Cannot reach … Is the backend
running and is this origin in FRONTEND_ORIGINS?"*:

- confirm the backend health check: `curl http://localhost:5000/api/health`
- confirm the origin in `backend/.env` exactly matches the browser origin
  (`http://localhost:5600` and `http://127.0.0.1:5600` are different origins)
- confirm `CORS_ALLOW_CREDENTIALS=true` (the default).

### Production hosting

Host this folder on the **same site** as the API where possible (for example
serve it from the Flask deployment under `/maintenance`, or a static host behind
the same domain). The refresh cookie is `SameSite=Lax`, so a truly cross-site
console can create a session but cannot silently refresh it. If a cross-site
deployment is required, configure the backend with:

```
REFRESH_COOKIE_SAMESITE=none
REFRESH_COOKIE_SECURE=true
FRONTEND_ORIGINS=https://maintenance.example.com
```

HTTPS is mandatory for a `SameSite=None` cookie.

The console itself holds the access token in memory only and keeps no token in
`localStorage`, so a page reload rehydrates the session through the HttpOnly
refresh cookie.

## Security notes

- Every screen is behind a staff role check, and every endpoint is behind the
  backend's `require_admin` decorator (admin **or** support). The UI check is a
  convenience, not the boundary.
- Document bytes are fetched with the bearer token and rendered from a Blob URL.
  They never appear as a bare URL, so the token cannot leak through history or a
  referrer.
- The server audits document reads (`identity.kyc.admin_view`) and decisions
  (`identity.vehicle.verify`, identity reviews), including the reviewer id.
- A rejection requires an actionable reason, shown to the captain.
- Support reviewers can work the queues but cannot grant `admin`/`support`
  roles; the role selector hides staff options for them, and the backend also
  refuses it.
- Do not deploy this folder publicly without the backend's RBAC — it is only
  static files, but an attacker who can sign in as a normal user still gets 403
  from every review endpoint.

## Files

```
index.html          shell: sign-in screen + signed-in layout
css/app.css         console styling (no external assets/fonts)
js/api.js           fetch client, memory-only token, silent refresh, document blobs
js/ui.js            icons, escaping, toasts, modals, reason prompts, doc viewer
js/app.js           hash router and the six screens
start.ps1/.cmd      zero-dependency static server on :5600
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Failed to fetch` / network error on sign-in | Backend down, wrong API base, or origin missing from `FRONTEND_ORIGINS` |
| `This account is not a staff reviewer` | The account's `role` is `user`/`driver`; promote it |
| 403 on approve/reject as support | Trying to grant a staff role; only admins can do that |
| Session ends after ~15 minutes with no refresh | Cross-site cookie blocked (`SameSite=Lax`); see production hosting above |
| Document viewer says 404 | Document no longer on file, or the vehicle packet is no longer `submitted` (vehicle-doc reads are limited to submitted packets) |
| You get signed out of one app when you sign into the other | Both apps run on `localhost`, so they share one refresh cookie. Use a private window or a second browser profile for staff review while staying signed in as a rider/captain in your normal window. |
| Render API returns 503 for `/api/health` | The deployment itself is down or failed its production boot gate (missing `DOCUMENT_ENCRYPTION_KEY`, `REDIS_URL`, `MONGO_URI`, `REFRESH_COOKIE_SECURE`, etc.) — this console cannot fix that remotely |
