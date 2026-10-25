# Room Memory IoT Platform — MVP Starter

This is a practical starter architecture for the Room Memory product:
- React + TypeScript + Vite + Tailwind-ready UI scaffold
- Node.js + Express API scaffold
- PostgreSQL schema for users, devices, readings, alerts, firmware and commands
- MQTT topic contract for device/cloud communication
- ESP32 Arduino firmware starter for existing sensors, TFT, MQTT TLS, alerts, and OTA design notes
- Docker Compose for PostgreSQL and Mosquitto development services

## Important status
This package is a **development starter**, not a production-certified IoT service. Before real customers use it, configure a real MQTT broker with TLS, authentication/ACLs, secure identity provisioning, push/email providers, cloud storage, backups, rate limiting, audit logging, and OTA signature verification. The included ESP32 OTA path is intentionally a scaffold: production firmware should verify a signed manifest/image before installing. Do not expose unauthenticated MQTT or HTTP endpoints publicly.

## Hardware retained
- ST7789 TFT: CS=5, DC=21, RST=22, MOSI=23, MISO=19, SCLK=18; landscape
- BMP280 I2C: SDA=25, SCL=26, CSB=3.3V, SDO=GND (0x76; fallback 0x77)
- DHT11 DATA=GPIO4
- LDR module DO=GPIO34 (digital input only; not light percentage)
- Rain sensor AO=GPIO35 (analog input; wetness percentage must be calibrated)
- Button GPIO27 to GND with INPUT_PULLUP

## Repository structure
- `apps/web` — customer portal and company admin UI starter
- `services/api` — REST API starter
- `database/schema.sql` — initial relational schema
- `infra/mosquitto` — local MQTT broker config for development only
- `firmware/RoomMemory_ESP32.ino` — ESP32 firmware starter and wiring
- `docs/architecture.md` — data flow and production hardening checklist

## Run the web UI
```bash
cd apps/web
npm install
npm run dev
```

## Run the API
```bash
cd services/api
npm install
cp .env.example .env
npm run dev
```

The API starter exposes health and demo device endpoints. It does not yet implement production authentication, cloud provisioning, or real MQTT ingestion.

## Local services
```bash
docker compose up -d
```
This starts local PostgreSQL and Mosquitto for development. The included Mosquitto config is local-development only.

## Firmware setup
Install ESP32 Arduino core and libraries:
- Adafruit GFX Library
- Adafruit ST7735 and ST7789 Library
- Adafruit BMP280 Library
- Adafruit Unified Sensor
- DHT sensor library
- PubSubClient (for MQTT prototype)

Configure Wi-Fi and MQTT broker credentials in the sketch. For production, use per-device credentials and TLS certificate validation; never ship shared default credentials. The firmware example uses placeholders and should be tested over USB before OTA.
