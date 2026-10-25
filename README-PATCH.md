# Room Memory — Productization Patch 1

This patch is based on the uploaded RoomMemory project. It fixes the first live-data issues and adds browser-based PDF export for reports.

## Included changes

1. **DHT11 room temperature**
   - Dashboard card now uses the DHT11 value (`dhtTemp`) and labels it `Room temperature`.
   - Temperature analytics and CSV use the DHT11 field first.
   - Alert evaluation uses DHT11 temperature when available.
2. **MQTT topic compatibility**
   - API subscribes to both the original local topic `room-memory/<deviceKey>/telemetry` and the versioned product topic `roommemory/v1/devices/<deviceKey>/telemetry`.
   - API maps firmware fields `dhtTemp`, `pressureHpa`, `rainWetnessPct`, and `ldrDO` into the existing telemetry table.
   - Firmware now builds its MQTT topic names from `DEVICE_ID` instead of the hard-coded `REPLACE_ID`.
3. **PDF export**
   - Sensor Analytics and Alert History each have an `Export PDF` button.
   - The browser print dialog opens; choose **Save as PDF** as the printer/destination.
   - Print layouts hide interactive controls and preserve report content/charts.
4. **TypeScript setup**
   - `tsconfig.json` specifies ESNext + Bundler module resolution.
   - Adds React type packages as web dev dependencies.

## Apply the patch

1. Back up your project first.
2. Extract this ZIP.
3. Copy the included files into the same relative paths inside your project folder, replacing the old files:
   - `apps/web/src/main.tsx`
   - `apps/web/src/Analytics.tsx`
   - `apps/web/src/Alerts.tsx`
   - `apps/web/src/analytics.css`
   - `apps/web/src/alerts.css`
   - `apps/web/tsconfig.json`
   - `apps/web/package.json`
   - `services/api/src/index.js`
   - `firmware/RoomMemory_ESP32.ino`
4. In a PowerShell terminal, update the web dependencies:
   ```powershell
   cd E:\OneDrive\Desktop\RoomMemory\apps\web
   npm install
   ```
5. Restart the API:
   ```powershell
   cd E:\OneDrive\Desktop\RoomMemory\services\api
   npm run dev
   ```
6. Restart the frontend:
   ```powershell
   cd E:\OneDrive\Desktop\RoomMemory\apps\web
   npm run dev
   ```
7. Reflash the ESP32 with the updated `.ino` only after checking that `DEVICE_ID` matches the device key registered in your database and that MQTT host, port, username, and password are correct.

## Important notes

- This patch does **not** configure a public cloud backend or customer Wi-Fi provisioning. The firmware still contains placeholder Wi-Fi/MQTT credentials; don't sell/ship it with shared credentials.
- Admin/User dashboards with real access control are not included in this first patch. The current API has no authentication middleware, so a role selector in the UI alone would not safely separate customer data. The next implementation step is backend login/session or token authentication, ownership checks on every device/telemetry/alert route, then the separate Admin and User interfaces.
- `Export PDF` uses the browser's print engine. In the print dialog select **Save as PDF**. CSV export remains available.
- Your uploaded ZIP contained `services/api/.env` with SMTP configuration. This patch intentionally excludes that file. Keep `.env` private and never share it in source-control or ZIPs. If the SMTP app password was a real credential, revoke it and create a new one.
- The project’s archived `node_modules` appears incomplete for this environment. `node --check services/api/src/index.js` passed, but a full web build could not be verified here because the uploaded dependencies lack React type declarations and a native optional Vite/Rolldown binding. Running `npm install` on your Windows machine should refresh dependencies; if `npm run build` still fails, send the first complete error.
