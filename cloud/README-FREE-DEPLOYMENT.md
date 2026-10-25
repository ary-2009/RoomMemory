# Room Memory free-tier deployment

This is a separate deployment path for a college demonstration when there is no VPS or domain. It does not replace the existing Docker Compose deployment in [`cloud/docker-compose.yml`](./docker-compose.yml).

## Recommended free-tier layout

| Component | Service | Important limitation |
| --- | --- | --- |
| React/Vite frontend | Cloudflare Pages | Static site; build-time API URL |
| Node/Express API | Render free web service | Sleeps when idle; cold starts |
| PostgreSQL | Neon free project | Small demo workload only; keep an independent export |
| MQTT | HiveMQ Cloud free cluster | Connection/message quotas; use TLS |

Free tiers and quotas change. Treat this as a demonstration deployment, not a durable production service.

## Before deploying

1. Keep the three existing root dumps unchanged. The valid migration source is `roommemory-before-fix.dump`; it contains the latest schema represented by the current API and one telemetry row. `roommemory-before-telemetry.dump` is an older valid snapshot with no `device_telemetry` table/data. `roommemory-backup.dump` is not a usable archive: it is UTF-16LE-transformed (`FF FE` followed by interleaved zero bytes), and reversing that transformation produces an empty/malformed archive with no recoverable tables.
2. Create a new Neon database. Never restore into the local Docker database.
3. Restore the valid dump into the new Neon database using `pg_restore --no-owner --exit-on-error`. If the provider does not allow direct `pg_restore`, use a temporary PostgreSQL 16 client and the provider's SSL connection string.
4. Verify the restored database before pointing the API at it:

   ```sql
   SELECT 'auth_users', count(*) FROM auth_users
   UNION ALL SELECT 'devices', count(*) FROM devices
   UNION ALL SELECT 'device_telemetry', count(*) FROM device_telemetry
   UNION ALL SELECT 'sensor_alert_events', count(*) FROM sensor_alert_events;
   ```

   Do not use `--clean` against a shared or existing database.

## Deploy the API on Render

1. Create a Render Blueprint from the repository and select [`render.yaml`](./render.yaml).
2. Enter the secret environment variables in the Render dashboard. Do not commit a `.env` file.
3. Set `DATABASE_URL` to the Neon SSL connection string.
4. Set `MQTT_URL`, `MQTT_USERNAME`, and `MQTT_PASSWORD` to a TLS-enabled HiveMQ Cloud connection. The ESP32 must use its own device credentials; never reuse the API credential for devices.
5. Deploy and check `https://YOUR-RENDER-SERVICE.onrender.com/api/health`.

The API is intentionally not given a public database or MQTT listener. Render's free sleep behavior means MQTT ingestion is not continuously available; for a live sensor demo, publish telemetry while the API is awake or use a paid/always-on service.

## Deploy the frontend on Cloudflare Pages

Use these build settings:

- Build command: `npm ci --prefix apps/web && npm run build --prefix apps/web`
- Build output directory: `apps/web/dist`
- Root directory: repository root
- Environment variable: `VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com`

After the Pages URL is known, set the API's `WEB_ORIGIN` exactly to that URL and redeploy the API. The shared [`apiBase.ts`](../apps/web/src/apiBase.ts) keeps login, analytics, alerts, admin, and overview requests on the same configured API instead of falling back to localhost.

## Migration safety

- Keep the original local PostgreSQL container and all three dumps unchanged until login, device ownership, telemetry history, alerts, and firmware metadata are verified in the new database.
- Do not run `docker compose down -v`, database drops, truncation, or `pg_restore --clean` against the local database.
- Export a fresh dump from the verified cloud database before making further schema changes.
- Remove `BOOTSTRAP_SECRET` from the API environment after confirming the existing administrator can log in.
