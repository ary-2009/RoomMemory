# Architecture and implementation plan

## Data path
ESP32 -> MQTT over TLS -> ingestion service -> PostgreSQL/time-series store -> REST/WebSocket -> user portal/admin portal.

## Topic contract (per-device ACL required)
- `roommemory/v1/devices/{deviceId}/telemetry` device publishes readings
- `roommemory/v1/devices/{deviceId}/status` device publishes online/health state
- `roommemory/v1/devices/{deviceId}/alerts` device publishes detected alerts
- `roommemory/v1/devices/{deviceId}/commands` cloud publishes authorized commands
- `roommemory/v1/devices/{deviceId}/command-ack` device publishes result
- `roommemory/v1/devices/{deviceId}/ota` cloud publishes signed firmware manifest reference

Do not allow a device to subscribe to another device's command topics. Enforce ACLs on the broker and ownership checks in the API.

## Roles
- Owner: can view/control only devices assigned to their account, export reports, configure thresholds, upload display backgrounds for their own devices.
- Company admin: can manage device fleet, customer assignments, firmware releases, diagnostics and audit events. Admin actions must be logged.

## Device control model
Use `standby` to stop nonessential sensor/display activity while keeping the network controller alive where possible. A true power-off cannot receive a remote wake command unless a separately powered controller or power-management circuit remains active. Hardware relay commands require a fail-safe design and physical electrical review.

## OTA safety
1. Build a versioned firmware artifact for the exact board and partition layout.
2. Publish a manifest containing version, size, SHA-256, minimum bootloader/partition requirements, and a digital signature.
3. Device fetches manifest over TLS and verifies signature using a public key embedded in firmware.
4. Download to the inactive OTA partition, verify digest and signature, then reboot.
5. Use rollback/health confirmation after boot and report success/failure.
6. Admin portal should show rollout cohorts, device compatibility, progress, failures and rollback state.

The firmware in this starter does not claim production-grade signed OTA. Add signature verification and a tested rollback strategy before commercial deployment.

## Alerts
Example default thresholds are only starter values:
- DHT11 temperature >= 35°C
- humidity >= 80%
- pressure < 950 hPa
- rain wetness >= 70%
- sensor failure after repeated invalid reads
- device offline if heartbeat is missing for configured interval

Use per-device configurable thresholds and debounce/cooldown to avoid notification spam. Deliver web notifications, email, and mobile push through server-side providers; never embed provider secrets in browser code.

## TFT background uploads
Browser accepts common image formats, resizes with `contain` (no crop), converts to RGB565, and uploads binary data to a device-specific object storage path. Device receives a short-lived signed download URL, verifies the downloaded file size/hash, stores it in LittleFS, then redraws. The web API must enforce ownership and file-size limits. Browser-side conversion is preferred to avoid decoding arbitrary image files on the microcontroller.

## Power / offline
Use local ring-buffer storage for readings during outages and replay once reconnected. Protect flash writes with batching/wear-leveling. A remote power-off must be implemented as standby or via a separately powered controller; fully removing device power prevents remote commands.
