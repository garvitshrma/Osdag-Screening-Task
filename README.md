# Osdag Auth Task — Secure Login System

Two backend implementations of a register / login / logout + file-access system,
both tested against the provided `web-client/index.html`:

- `custom-backend/` — Django + Django REST Framework + PostgreSQL
- `appwrite-backend/` — Appwrite (managed backend)

---

## A) Custom Backend (Django + DRF + PostgreSQL)

### Setup

```
cd custom-backend
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py seed
python manage.py runserver
```

Then serve the client and open it:

```
cd web-client
python -m http.server 5500
# open http://localhost:5500/index.html
# choose "Custom REST backend", Base URL = http://127.0.0.1:8000
```

### Seeded test users (all password: `Password123!`)
- alice@example.com — 2 files
- bob@example.com — 2 files
- carol@example.com — 2 files

### How it was built (overview)
Created a Django project (`config`) with one app (`accounts`) holding the models,
views, URLs, and a custom auth class. `settings.py` wires up DRF, PostgreSQL (via a
`.env` file), CORS, and throttling. Models: `Profile` (1-to-1 with the built-in User)
and `File` (each with an `owner` foreign key). Endpoints: `/register`, `/login`,
`/logout`, `/me`, `/files`, `/files/:id`, `/files/:id/download`.

### Reasoning: JWT vs session-based authentication
I used **server-side token authentication** (DRF's `TokenAuthentication`), not
stateless JWT. A stateless JWT stores the session inside the token and the server
keeps no record — it just verifies the signature. A server-side token stores a
`token → user` row in the database and validates each request by looking it up.

The deciding factor was the requirement that **logout invalidate the session
server-side**. A stateless JWT can't truly do this: with no server record, a signed
token stays valid until it expires even after logout (you'd need a denylist to fake
revocation). A stored token makes logout real — deleting the row instantly kills the
token. I chose the approach whose natural behaviour matches the requirement.
Trade-off accepted: one DB lookup per request, versus a stateless JWT's zero-lookup
speed and easier horizontal scaling — worth it at this scale.

### How logout works under the hood
`/logout` is a **protected** route (it requires a valid token, so the server knows
*which* token to remove). The handler runs `request.user.auth_token.delete()`, which
deletes that user's row from the `authtoken_token` table. Because the token now has
no server-side record, it authenticates nobody — this is true **server-side
invalidation**, not just clearing the client. Verified: after logout, reusing the
same token on `/me` returns 401.

### How user data isolation is enforced
Every file row carries an `owner` foreign key to a User. Protected routes never trust
an identifier supplied by the client — they use `request.user`, which DRF derives
from the validated token. `/me` returns only `request.user`'s profile. `/files`
queries `File.objects.filter(owner=request.user)`, so it can only ever return the
caller's files. `/files/:id` and the download route first load the file, then check
`file.owner_id != request.user.id`:
- file does not exist → **404**
- file exists but belongs to someone else → **403** (deliberately distinct from 404)
- file belongs to the caller → 200

Verified with Alice's token: her own file → 200, Bob's file → 403, a non-existent
id → 404. The download route repeats the same ownership check, so bytes can't be
pulled by guessing a URL.

### Other security practices
- Passwords hashed with Django's PBKDF2 (`create_user` / `authenticate`); never stored plaintext.
- Login returns a single generic error ("Invalid email or password") whether the
  email is unknown or the password is wrong — never reveals if an email is registered.
- Login is rate-limited (DRF throttle, 5/min per IP).
- The same token auth is applied consistently across all protected routes (a custom
  `BearerTokenAuthentication` so the header keyword matches the provided client's `Bearer`).

### What I'd improve given more time
- Set `DEBUG=False` and a locked-down `ALLOWED_HOSTS` / specific `CORS` origins for production.
- Add token expiry / rotation (DRF's default tokens don't expire).
- Per-account lockout on repeated failures (in addition to IP-based throttling).
- A dedicated email-based custom User model instead of storing email as username.
- Store files in real object storage (e.g. S3) rather than local media.

---

## B) Appwrite Backend

_(to be completed after building the Appwrite implementation)_
