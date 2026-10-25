# Room Memory cloud deployment scaffold (VPS + Docker Compose)

This is a deployment scaffold for the current auth-enabled Room Memory API and React UI. It uses one Ubuntu VPS, Docker Compose, Caddy for automatic HTTPS on the web/API, PostgreSQL on a private Docker network, and Mosquitto with a private API listener plus a public TLS listener for ESP32 devices.

**Not a one-click production certification.** Before selling at scale, perform a security review, test account/device isolation, add backups/restore drills, monitor disk usage, and use unique MQTT credentials per device. Do not expose PostgreSQL or MQTT port 1883 to the public internet.

## 0. Prerequisites

- Ubuntu 24.04 VPS with a static public IPv4 address; 2 vCPU / 4 GB RAM is a reasonable starting point for a small pilot.
- A domain you control, e.g. `roommemory.example.com`, and a DNS record `A roommemory.example.com -> VPS_IP`.
- A separate hostname for MQTT, e.g. `mqtt.roommemory.example.com`, with an `A` record to the same VPS IP.
- Firewall allows inbound TCP 22 (restricted to your IP if possible), TCP 80/443 for the website, and TCP 8883 for MQTT TLS. Do not open 5432 or 1883 publicly.
- Docker Engine and Docker Compose plugin installed on the VPS.

## 1. Prepare the project

1. Back up the working Windows project first.
2. Copy this `cloud` folder into the project root, keeping its directory structure (so `RoomMemory/cloud/docker-compose.yml` and `RoomMemory/cloud/infra/...` exist). Keep your existing `services/api/.env` local file private; do not upload it to Git.
3. Copy the auth-enabled API from the current working JWT fix into `services/api/src/index.js` if your current API differs. The included API file is based on the auth/JWT fix and adds MQTT username/password support. Compare before replacing so you do not lose later custom edits.
4. The included frontend `main.tsx` changes API base to same-origin (`/api`) for cloud hosting. Merge this one-line change into the current `apps/web/src/main.tsx` if it has additional newer edits.
5. From the project root, create the root `.env` from the example and edit it:

   ```bash
   cp cloud/.env.production.example ./.env
   ```

   Set `DOMAIN`, `WEB_ORIGIN`, all strong secrets/passwords and SMTP settings. Never commit `.env`.

The Compose file uses paths relative to `cloud/docker-compose.yml`, while build contexts point to the project root. Run Compose from the project root:

```bash
docker compose --env-file .env -f cloud/docker-compose.yml config
docker compose --env-file .env -f cloud/docker-compose.yml up -d --build
```

## 2. Migrate existing PostgreSQL data safely

**Do not initialize a fresh production database with the old `database/schema.sql` blindly.** The current running app uses `devices`, `device_telemetry`, `sensor_alert_events`, and `auth_users`; the historical starter schema in this repository may not exactly match your live DB.

On the Windows machine, make a backup of the real running database first:

```powershell
docker exec roommemory-postgres-1 pg_dump -U roommemory -d roommemory -Fc > roommemory-backup.dump
```

Copy `roommemory-backup.dump` to the VPS using a secure method (e.g. `scp`). Create/start the cloud PostgreSQL service, then restore into an empty cloud DB before starting the API:

```bash
docker compose --env-file .env -f cloud/docker-compose.yml up -d postgres
# Copy dump to VPS project root, then:
docker cp roommemory-backup.dump "$(docker compose --env-file .env -f cloud/docker-compose.yml ps -q postgres)":/tmp/roommemory-backup.dump
docker compose --env-file .env -f cloud/docker-compose.yml exec -T postgres sh -lc 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/roommemory-backup.dump'
```

If the database dump was produced by a different PostgreSQL major version, check `pg_dump --version` and the server version first. Keep the local backup until you verify login, customers, devices, telemetry, alert history and email notifications in the cloud.

## 3. Set up MQTT TLS certificate

The web certificate is issued/renewed automatically by Caddy. Mosquitto needs its own certificate files for `mqtt.roommemory.example.com`.

Create the cert directory on the VPS:

```bash
mkdir -p cloud/infra/mosquitto/certs
chmod 700 cloud/infra/mosquitto/certs
```

Obtain a trusted Let's Encrypt certificate for the MQTT hostname using Certbot DNS challenge (recommended if your DNS provider supports an API plugin), or another trusted ACME method. Copy the resulting `fullchain.pem` and `privkey.pem` into:

- `cloud/infra/mosquitto/certs/fullchain.pem`
- `cloud/infra/mosquitto/certs/privkey.pem`

The certificate must include `mqtt.roommemory.example.com` in its SAN. Restrict the private key to root and the Docker service account. Plan certificate renewal and restart Mosquitto after renewal; test renewal before relying on it. Do not use self-signed certificates for customer devices.

## 4. Create MQTT credentials

Create a password file on the VPS. The commands below prompt for each password; do not put passwords into Git or chat.

```bash
docker run --rm -it -v "$PWD/cloud/infra/mosquitto:/mosquitto/config" eclipse-mosquitto:2 mosquitto_passwd -c /mosquitto/config/password_file roommemory_api
# Add one user per device. The username must exactly match its device_key, e.g. RM-001:
docker run --rm -it -v "$PWD/cloud/infra/mosquitto:/mosquitto/config" eclipse-mosquitto:2 mosquitto_passwd /mosquitto/config/password_file RM-001
chmod 600 cloud/infra/mosquitto/password_file
```

Set `MQTT_USERNAME=roommemory_api` and `MQTT_PASSWORD` in root `.env` to the API user's same password. The API listener uses `mqtt://mosquitto:1883` only inside the private Docker network. Devices connect to `mqtt.roommemory.example.com:8883` with TLS and their own per-device credentials. The ACL restricts a device to topics whose device key matches its MQTT username.

**Firmware:** set `MQTT_HOST` to `mqtt.roommemory.example.com`, `MQTT_PORT` to `8883`, `MQTT_USER` to the device key, `MQTT_PASSWORD` to that device's unique password, and the topic strings to the same device key. Install the public root CA certificate using `tlsClient.setCACert(ROOT_CA_PEM)` before connecting; never leave TLS verification commented out. Provision the customer's Wi-Fi securely; do not ship a shared Wi-Fi password or shared MQTT password across all devices.

## 5. Start services

Before bringing all services up, ensure the MQTT certificate files and password file exist. Then:

```bash
docker compose --env-file .env -f cloud/docker-compose.yml config
docker compose --env-file .env -f cloud/docker-compose.yml up -d --build
docker compose --env-file .env -f cloud/docker-compose.yml ps
docker compose --env-file .env -f cloud/docker-compose.yml logs -f api mosquitto caddy
```

Caddy will obtain the HTTPS certificate for `DOMAIN` when DNS and ports 80/443 are correct. The web app and `/api/*` use the same HTTPS origin, so the browser does not call `localhost`.

Health check: `https://YOUR_DOMAIN/api/health`.

## 6. First-admin and security checklist

- Restore the existing database and verify the existing admin record first; do not create a duplicate admin.
- Set `JWT_SECRET` to a stable random 32-byte-or-longer secret. Changing it invalidates active sessions.
- If the admin already exists, remove `BOOTSTRAP_SECRET` from the production `.env` after confirming first-admin setup is no longer needed, then restart the API.
- Confirm API routes enforce auth and per-device ownership; a UI-only hide is not authorization. Test a customer cannot read another customer's telemetry or alerts.
- Change any credentials exposed in past project ZIPs or source files.
- Configure automated encrypted PostgreSQL backups off the VPS and test a restore.
- Configure OS security updates, SSH key-only access, firewall, monitoring, disk alerts, and log rotation.
- Use unique MQTT credentials per device and certificate validation in firmware. Avoid OTA updates over unauthenticated HTTP.

## 7. Operational commands

```bash
docker compose --env-file .env -f cloud/docker-compose.yml logs -f api
docker compose --env-file .env -f cloud/docker-compose.yml restart api
docker compose --env-file .env -f cloud/docker-compose.yml pull
docker compose --env-file .env -f cloud/docker-compose.yml up -d --build
```

Keep a current encrypted backup before upgrades. Do not run `docker compose down -v` on production; it deletes named data volumes.
