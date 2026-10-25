# RoomMemory — local development restore package

This package is a cleaned **local-development** copy of the uploaded RoomMemory project.
It preserves the supplied frontend, API, database schema/migrations, and ESP32 firmware source.
Cloud reverse-proxy files and Dockerfiles that referenced a missing `cloud/` directory were omitted.

## Important notes

- The original uploaded folder and its `.env` were not modified.
- Real `.env` secrets, the database dump, build output, dependencies, and TLS private-key/certificate files are intentionally not included.
- The current `apps/web/src/main.tsx` and `services/api/src/index.js` were retained because no verified original copies of those files were available. This package does **not** claim to reconstruct their exact pre-cloud versions.
- The Mosquitto configuration below allows anonymous MQTT, but Docker publishes it only on `127.0.0.1`. This is for local testing only. Do not expose this broker to a LAN or the internet.
- The Compose database volume persists data. `docker compose down -v` deletes that volume; do not use it if you need to keep local database data.

## Requirements

- Node.js 20+ (Node 22 recommended)
- Docker Desktop with Docker Compose
- Arduino IDE for ESP32 firmware work

## 1. Start local PostgreSQL and MQTT

From this directory:

```powershell
docker compose up -d
docker compose ps
```

The first PostgreSQL start creates a fresh database and runs the schema/migrations. Init scripts only run when the PostgreSQL data volume is empty.

## 2. Configure and start the API

```powershell
Copy-Item services/api/.env.example services/api/.env
cd services/api
npm install
npm run dev
```

If `services/api/.env` already exists, do not overwrite it; retain your existing credentials and update only values that need changing. The sample database password matches the local Compose file.

API health check: `http://localhost:8080/api/health`

## 3. Start the web dashboard

Open a second PowerShell terminal:

```powershell
cd apps/web
npm install
Copy-Item .env.example .env
npm run dev
```

If `apps/web/.env` already exists, inspect it before copying the example over it.

Open the Vite URL printed in the terminal, usually `http://localhost:5173`.

## 4. Database and backup safety

The original `roommemory-backup.dump` was deliberately left out of this distribution ZIP to avoid duplicating potentially sensitive device/user data. It remains in your original project folder. Do not restore it unless you specifically want to replace the current database with the backup contents.

## 5. ESP32 firmware

The existing `firmware/RoomMemory_ESP32.ino` is included unchanged. The local MQTT broker binds to the computer's loopback interface, so an ESP32 on Wi-Fi cannot connect to it through `localhost`. To test MQTT from the ESP32, configure a broker reachable on your LAN with authentication and appropriate firewall rules; do not expose the anonymous local broker.

## What's included

- React/Vite dashboard source and UI modules
- Express API source and package files
- PostgreSQL schema and SQL migrations
- ESP32 firmware
- local-only Compose configuration and environment templates
- project documentation

## Recovery recommendation

Keep the original project folder until you verify the new ZIP works. Extract this ZIP into a **new folder**, start the services, and test the dashboard before copying anything back into your original folder.
