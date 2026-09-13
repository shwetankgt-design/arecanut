# Security Hardening — Arecanut Farmer Survey

Mapped to the **OWASP Top 10 (2021)** and relevant **OWASP ASVS** controls.
This documents what changed and why; see inline code comments for
implementation detail.

## A01 — Broken Access Control
- Every survey/dashboard endpoint requires a valid JWT (`get_current_user`);
  writes require role checks (`require_role("admin", "enumerator" | "admin")`)
  — only admins can delete records.
- `TrustedHostMiddleware` rejects requests with a spoofed `Host` header in
  production (`ALLOWED_HOSTS` must be set explicitly there).

## A02 — Cryptographic Failures
- Passwords hashed with bcrypt (adaptive, salted).
- Refresh tokens are stored **only as SHA-256 hashes** — a DB leak can't be
  replayed into a session (`app/auth.py`).
- `JWT_SECRET` has no usable default in production — `get_settings()` raises
  on startup if it's missing (`app/config.py`). Dev gets a random per-process
  secret instead of a fixed one.
- Access tokens are short-lived (30 min default); long sessions are handled
  by refresh-token rotation, not by a long-lived access token.

## A03 — Injection
- All queries go through SQLAlchemy's ORM/parameter binding — no raw SQL
  string interpolation anywhere, including the dynamic filter builder in
  `list_surveys` and the `.like()` search clauses.
- Every request body is validated by Pydantic models with explicit types,
  length caps, and range constraints (`app/schemas.py`) — nothing free-form
  reaches the database layer.

## A04 — Insecure Design
- Refresh-token **reuse detection**: replaying an already-rotated refresh
  token revokes every other active session for that user, treating reuse as
  a compromise signal rather than silently accepting it.
- Account lockout after 5 failed logins (15 min), independent of rate
  limiting, so a distributed attacker can't just spread attempts across IPs.
- Server-side validation mirrors (and is authoritative over) the client-side
  wizard validation — the API never trusts the frontend's checks alone.

## A05 — Security Misconfiguration
- `SecurityHeadersMiddleware` sets `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`, and HSTS
  (when served over HTTPS) on every response.
- CORS is origin-restricted via `CORS_ORIGINS` and credential-less (Bearer
  auth needs no cookies); `"*"` is refused outright if `ENV=production`.
- `debug=False` in non-development environments — no stack traces or
  interactive tracebacks leak to clients.
- SQLite is refused in production (`db.py`) — `DATABASE_URL` must point at a
  real, managed PostgreSQL instance.

## A06 — Vulnerable & Outdated Components
- `requirements.txt` pins the dependency set explicitly; run `pip-audit` /
  `npm audit` in CI before each release (not yet wired into a pipeline here —
  see "Not done" below).

## A07 — Identification & Authentication Failures
- JWT + rotating refresh tokens (see A02/A04), bcrypt hashing, account
  lockout, and a password-strength check (`validate_password_strength`) ready
  for any future self-service password change/creation flow.
- Rate limiting on `/auth/login` and `/auth/refresh` (`slowapi`, default
  5/minute) blunts credential-stuffing and brute force.

## A08 — Software & Data Integrity Failures
- Offline-queued survey submissions are deduplicated server-side by
  `client_uuid`, so a retried sync can't silently duplicate data.
- `AuditLog` (append-only) records login success/failure/lockout and every
  survey create/update/delete with the acting user, IP, and timestamp.

## A09 — Security Logging & Monitoring Failures
- `audit()` writes structured log rows to the `audit_log` table for every
  security-relevant event (see A08). In a real deployment, ship this table
  (or a parallel structured log stream) to a SIEM.

## A10 — Server-Side Request Forgery
- Not applicable: the API makes no outbound requests based on user-supplied
  URLs.

## API-specific (OWASP API Security Top 10)
- **API4:2023 Unrestricted Resource Consumption** — `GET /api/surveys` now
  caps `limit` (default 500, max 1000) and supports `offset`, instead of
  returning the entire table on every call.

## Configuration reference (`app/config.py`)
| Variable | Purpose | Production requirement |
|---|---|---|
| `ENV` | `development` \| `staging` \| `production` | must be set explicitly |
| `DATABASE_URL` | SQLAlchemy DSN | real PostgreSQL, not SQLite |
| `JWT_SECRET` | HMAC signing key | required, high-entropy, from a secrets manager |
| `CORS_ORIGINS` | comma-separated allow-list | explicit origins, never `*` |
| `ALLOWED_HOSTS` | comma-separated Host allow-list | your real domain(s) |
| `RATE_LIMIT_LOGIN` / `RATE_LIMIT_DEFAULT` | slowapi rate strings | tune to expected traffic |

## Not done in this pass (needs real infrastructure this sandbox doesn't have)
- **TLS termination** — HSTS header is emitted but there's no HTTPS listener
  here; terminate TLS at a load balancer/reverse proxy in front of Uvicorn.
- **Managed secrets store** (Vault/AWS Secrets Manager/etc.) — `.env` /
  process environment variables are the interim mechanism.
- **Dependency/SAST scanning in CI** — no pipeline exists yet to run
  `pip-audit`, `npm audit`, or a SAST tool automatically.
- **WAF / DDoS protection at the edge** — expected to sit in front of this
  app in production (e.g. Cloudflare, AWS WAF), not implemented in-app beyond
  the rate limiter.
