# SwiftTrack Express

A professional shipment tracking web application inspired by modern delivery services. Includes real-time tracking, shipment creation, printable shipping labels with barcodes, rates calculator, location finder, and an admin control center.

## Features
- Track shipments by tracking number
- Create shipments with sender/recipient details
- Printable label with QR code linking the tracking number
- Simple rates calculator (weight + distance)
- Locations page with sample hubs
- Admin page to update shipment status
- JSON file datastore (no external DB)

## Tech
- Node.js + Express
- EJS views
- QR Code via `qrcode`
- IDs via `uuid`
- Dates via `dayjs`

## Quick Start

```bash
# From the project root
npm install
npm run dev
# Open http://localhost:3000
```

### Admin Auth
- Protects `/admin/shipments` page and `PATCH /api/shipments/:id/status`.
- Uses HTTP Basic Auth with env vars: `ADMIN_USER` and `ADMIN_PASSWORD`.
- Example:
```bash
ADMIN_USER=admin ADMIN_PASSWORD=change-me npm run dev
```

## API
- POST `/api/shipments`
  - body: `{ senderName, senderAddress, recipientName, recipientAddress, originCity, destinationCity, weightKg }`
  - 201 Created -> full shipment JSON
- GET `/api/track/:trackingNumber` -> shipment JSON or 404
- GET `/api/shipments/:id` -> shipment JSON
- PATCH `/api/shipments/:id/status`
  - body: `{ status }`
  - 200 OK -> updated shipment JSON (requires Basic Auth)
- GET `/api/shipments/:id/label.png` -> QR label PNG (tracking number)

## Notes
- SwiftTrack Express is a demo application. This is not affiliated with any real shipping company.
- Do not use any third-party company's branding, assets, or trademarks in production.
- Local development can use SQLite, but Vercel deployments require a durable database such as MongoDB Atlas or Postgres.
- SQLite in `/tmp` on Vercel is ephemeral and will lose data across deploys and cold starts.
- Admin routes require Basic Auth (ADMIN_USER and ADMIN_PASSWORD environment variables).

## Docker

Build and run with Docker:
```bash
docker build -t parceltrack .
docker run --rm -p 3000:3000 \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD=change-me \
  parceltrack
# Open http://localhost:3000
```

Persist data by mounting a volume:
```bash
docker run --rm -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD=change-me \
  parceltrack
```
