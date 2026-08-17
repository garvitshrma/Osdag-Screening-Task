# Osdag Auth Task — Secure Login System

Two independent backend implementations of a register / login / logout + file-access
system, both driven by the **same** provided test client (`web-client/index.html`):

- **`custom-backend/`** — a hand-written backend: Django + Django REST Framework + PostgreSQL
- **`appwrite-backend/`** — a managed backend: Appwrite Cloud, with a thin browser adapter

The client's radio buttons ("Custom REST backend" / "Appwrite") switch which backend is
exercised, so one HTML file tests both.

---

## Repository layout

```
osdag-auth-task/
├── custom-backend/       # Django project (config/) + accounts app, seed command
├── appwrite-backend/     # Appwrite seed script + env template (server-side setup)
├── web-client/           # the provided test client + the Appwrite browser adapter
│   ├── index.html
│   ├── mock-api.js
│   ├── seed-data.json
│   └── appwrite-adapter.js
└── README.md
```

The three seeded users are the same across both backends (from `web-client/seed-data.json`):

| Email               | Password       | Files |
|---------------------|----------------|-------|
| alice@example.com   | Password123!   | 2     |
| bob@example.com     | Password123!   | 2     |
| carol@example.com   | Password123!   | 2     |

---

## A) Custom Backend — Django + DRF + PostgreSQL

### Setup

```
cd custom-backend
python -m venv venv
venv\Scripts\Activate.ps1          # Windows PowerShell  (use: source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
copy .env.example .env             # then fill in real DB credentials (see .env.example)
python manage.py migrate
python manage.py seed              # creates the 3 users + their files
python manage.py runserver         # serves the API at http://127.0.0.1:8000
```

You also need a PostgreSQL database and user that match your `.env`. One-time creation:

```
CREATE DATABASE osdag_auth;
CREATE USER osdag_user WITH PASSWORD 'your-password';
ALTER DATABASE osdag_auth OWNER TO osdag_user;
\c osdag_auth
GRANT ALL ON SCHEMA public TO osdag_user;
```

To test through the client:

```
cd web-client
python -m http.server 5500
# open http://localhost:5500/index.html
# choose "Custom REST backend", Base URL = http://127.0.0.1:8000
```

### How it is built (overview)

A Django project (`config`) with a single app (`accounts`) holding the models, views,
URLs, a custom auth class, and the seed command. `settings.py` wires up DRF, PostgreSQL
(via a `.env` file), CORS, and login throttling.

- **Models:** `Profile` (one-to-one with Django's built-in `User`) and `File` (each with
  an `owner` foreign key to `User`). Email is stored as the username, which gives us
  email-uniqueness and Django's battle-tested password hashing for free.
- **Endpoints:** `POST /register`, `POST /login`, `POST /logout`, `GET /me`,
  `GET /files`, `GET /files/:id`, `GET /files/:id/download`.
- **Auth class:** a small `BearerTokenAuthentication` subclass so the token is read from
  the `Authorization: Bearer <token>` header the client sends (DRF's default keyword is
  `Token`; the provided client uses `Bearer`).

### Reasoning: JWT vs session-based authentication

I used **server-side token authentication** (DRF's `TokenAuthentication`), not stateless
JWT. The two differ in *where the session lives*. A stateless JWT stores the session
inside the token itself — the server keeps no record and only verifies the signature. A
server-side token stores a `token → user` row in the database and validates each request
by looking it up.

The deciding factor was the requirement that **logout invalidate the session
server-side**. A stateless JWT cannot truly satisfy this: with no server record, a signed
token stays valid until it expires even after "logout" — you'd need a denylist to fake
revocation, which quietly reintroduces the per-request lookup that made JWT attractive in
the first place. A stored token makes logout real and simple: deleting the row instantly
kills the token. So I chose the approach whose natural behaviour matches the requirement.

Trade-off I'm accepting: one database lookup per request, versus a stateless JWT's
zero-lookup validation and easier horizontal scaling. At this task's scale, and given the
explicit server-side-logout requirement, that trade-off is clearly worth it.

### How logout works under the hood

`POST /logout` is a **protected** route — it requires a valid token, so the server knows
*which* token to remove. The handler runs `request.user.auth_token.delete()`, which
deletes that user's row from the `authtoken_token` table. Once the row is gone, the token
authenticates nobody, even if a copy of the string still exists on a client. This is true
**server-side invalidation**, not merely clearing the token in the browser.

Verified: after logout, reusing the same token on `GET /me` returns **401**.

### How user data isolation is enforced

Every `File` row carries an `owner` foreign key. Protected routes never trust an identifier
supplied by the client — they use `request.user`, which DRF derives from the validated
token, so the caller cannot impersonate anyone by passing a different id.

- `GET /me` returns only `request.user`'s profile.
- `GET /files` runs `File.objects.filter(owner=request.user)` — it can only ever return
  the caller's files.
- `GET /files/:id` (and the download route) load the file, then check
  `file.owner_id != request.user.id`:
  - file does not exist → **404**
  - file exists but belongs to someone else → **403** (deliberately distinct from 404)
  - file belongs to the caller → **200**

Verified with Alice's token: her own file → 200, Bob's file → 403, a non-existent id → 404.
The download route repeats the same ownership check, so bytes cannot be pulled by guessing
a URL.

### Other security practices

- Passwords are hashed with Django's PBKDF2 (`create_user` / `authenticate`); plaintext is
  never stored.
- Login returns a single generic error ("Invalid email or password") whether the email is
  unknown or the password is wrong, so it never reveals whether an email is registered.
- Login is rate-limited (DRF throttle, 5 requests/min per IP).
- The same token authentication is applied consistently across all protected routes.
- Secrets (DB password, `SECRET_KEY`) live in `.env`, which is gitignored; `.env.example`
  documents the required keys.

---

## B) Appwrite Backend — managed backend + browser adapter

### What "the backend" is here

With Appwrite there is **no server I wrote**. Appwrite Cloud *is* the backend. The provided
`index.html`, plus a small `appwrite-adapter.js`, talks **directly** to Appwrite from the
browser using Appwrite's Web SDK. So the Appwrite implementation is three parts:

1. **Appwrite Cloud configuration** (done once in the console — see setup below)
2. **`appwrite-backend/seed.js`** — a Node script that creates the 3 users and their files
3. **`web-client/appwrite-adapter.js`** — a browser adapter that maps the client's routes
   (`/register`, `/login`, …) onto Appwrite SDK calls

### Appwrite Cloud setup (console)

1. Create a project. Note its **Project ID** and **API Endpoint** (region-specific, e.g.
   `https://sgp.cloud.appwrite.io/v1`).
2. Add a **Web platform** with hostname `localhost` (lets the browser SDK call the project).
3. Create a **Database**. Note its **Database ID**.
4. Create a **collection/table** with ID `files` and these attributes/columns:
   `ownerId` (string), `fileName` (string), `mimeType` (string), `sizeBytes` (integer),
   `storageFileId` (string).
5. On that collection, enable **Row/Document Security** and leave the collection-level
   permissions **empty** (access is granted per-row by the seed script).
6. Create a **Storage bucket** (note its **Bucket ID**) and enable **File Security**, with
   bucket-level permissions empty.
7. Create an **API key** with scopes for users, databases/documents, and files. This is a
   secret (used only by the server-side seed script).

### Seed the users and files

```
cd appwrite-backend
npm install
copy .env.example .env      # fill in endpoint, project ID, API key, database ID, bucket ID
node seed.js                # creates 3 users + owner-stamped files and documents
```

`seed.js` is idempotent — it wipes the existing seeded users, documents, and files first,
so it is safe to re-run.

### Run the client against Appwrite

```
cd web-client
python -m http.server 5500
# open http://localhost:5500/index.html
```

Select **Appwrite** mode and fill the **Appwrite settings** fields with your own project's
values:

- Endpoint (e.g. `https://sgp.cloud.appwrite.io/v1`)
- Project ID
- Database ID
- Files collection ID = `files`
- Storage bucket ID

(These are client-side identifiers, not secrets. The included `index.html` has the author's
values pre-filled in the field defaults — replace them with yours.)

> **SDK version note:** the Appwrite Web SDK loaded in `index.html` was updated to a version
> matching the current Appwrite Cloud server; an outdated SDK returns 404s on some endpoints.

### How the adapter works

`appwrite-adapter.js` wraps `window.fetch`. When Appwrite mode is selected it intercepts
**only the app's own routes** (`/register`, `/login`, `/me`, `/files`, …) and translates
them into Appwrite SDK calls; every other request (including the SDK's own `/v1/...` calls
to Appwrite) is passed straight through. Mapping:

| App route            | Appwrite SDK call                              |
|----------------------|------------------------------------------------|
| `POST /register`     | `account.create(...)`                          |
| `POST /login`        | `account.createEmailPasswordSession(...)`      |
| `POST /logout`       | `account.deleteSession('current')`             |
| `GET /me`            | `account.get()`                                |
| `GET /files`         | `databases.listDocuments(...)`                 |
| `GET /files/:id`     | `databases.getDocument(...)`                   |
| `GET /files/:id/download` | `storage.getFileDownload(...)`            |

### How logout works (Appwrite)

`account.deleteSession('current')` deletes the current session **on Appwrite's servers**.
Appwrite manages sessions server-side by design, so this is genuine server-side
invalidation — the session cookie is worthless afterward.

### How data isolation is enforced (Appwrite)

Isolation is **configured, not coded**. The seed script stamps every file document and
every stored file with a permission that grants read access **only to its owner**
(`Permission.read(Role.user(userId))`), and Row/File Security is enabled. Consequently:

- `databases.listDocuments()` returns **only** the documents the logged-in user is
  permitted to read — I write no `owner` filter at all.
- `getDocument()` / file download for another user's item is rejected by Appwrite itself.

I wrote **zero** ownership-check code for Appwrite; the permission model enforces it.

### What Appwrite handled automatically vs what I configured

**Appwrite handled automatically:**

- Password hashing and storage (argon2) — I never touch it.
- Session issuing, storage, and validation, including server-side logout.
- **Per-user data isolation enforcement** — once permissions are set, every query is
  filtered by them automatically.
- User management (create/list/delete), the file storage service, and the REST API and
  Web SDK themselves.

**I configured / wrote myself:**

- The project, a Web platform for `localhost`, a database, the `files` collection and its
  attributes, indexes/permissions settings (Row & File Security).
- The **permission rules** that make isolation work (owner-only read on each document/file).
- The **seed script** (`seed.js`) that creates users and owner-stamped files via the server
  SDK + API key.
- The **browser adapter** (`appwrite-adapter.js`) mapping the client's route contract onto
  SDK calls.

### A deliberate difference between the two backends

For "a file that exists but belongs to another user," the **custom backend returns 403**
(it confirms the resource exists but denies access, as the task requested), while the
**Appwrite backend returns 404** (its security model hides the existence of resources you
can't access). Both are defensible: 403 is more transparent; 404 leaks less information.
Building both surfaced this trade-off directly.

---

## What I would improve given more time

- **Custom backend:** run with `DEBUG=False`, a locked-down `ALLOWED_HOSTS`, and specific
  CORS origins for production; add token expiry/rotation (DRF's default tokens don't
  expire); add per-account lockout on repeated failures (in addition to IP throttling);
  use a dedicated email-based custom User model instead of storing email as username;
  store files in object storage (e.g. S3) rather than local media.
- **Appwrite backend:** store richer profile fields (bio, role) in a dedicated profiles
  collection or user preferences (Appwrite's user object only carries name/email); align
  the adapter's error mapping so it can distinguish "not found" from "forbidden" if the
  task requires a 403; pin the Web SDK version explicitly.
- **Both:** automated tests for the auth and isolation paths, and CI to run them.