# Room Memory Phase 2 — Admin and Customer Accounts

This patch adds API authentication (JWT bearer tokens), hashed passwords, an initial administrator setup screen, admin-only customer management, device assignment, and customer ownership checks on device/telemetry/alert endpoints. It builds on Productization Patch 1.

## Install
1. Back up your current RoomMemory project.
2. Extract this ZIP into the project root and copy the included files into the same relative paths, replacing files when prompted.
3. From `services/api`, run `npm install`.
4. Add `JWT_SECRET` and `BOOTSTRAP_SECRET` from `services/api/.env.auth.example` to your existing `services/api/.env`. Use two different random secrets; never paste them into chat or commit `.env`. Keep your existing database, MQTT, and SMTP settings.
5. Apply the database migration from the project root in PowerShell:

```powershell
docker exec -i roommemory-postgres-1 psql -U roommemory -d roommemory < database/002_auth_and_ownership.sql
```

6. From `apps/web`, run `npm install` and `npm run build`.
7. Restart the API and frontend. Open the web app. Choose **First-time setup** to create the first administrator using the `BOOTSTRAP_SECRET`. The endpoint stops working once an admin exists.
8. Sign in as admin. Open **Admin · customers**, create customer accounts, and assign each device to its owner. Unassigned devices are admin-only.

## Important
- Customer passwords must be at least 12 characters and are hashed with bcrypt. API endpoints validate signed tokens and device ownership on the server.
- This is a local/development account-management foundation, not a complete production security review. Before selling devices, deploy HTTPS, use a strong random JWT secret, remove/rotate the bootstrap secret after first admin creation, add password reset and rate limiting, and configure per-device MQTT credentials/ACLs.
- Existing devices are unassigned after migration and therefore visible only to admins until assigned. This is intentional and safer than granting every customer access.
- The existing API's alert email destination is currently a single `ALERT_EMAIL_TO` environment variable; per-customer email delivery needs a separate follow-up change.
