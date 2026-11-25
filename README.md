# Room Booking Hub — Office Meeting Rooms

A standalone Angular 21 application for scheduling office meeting rooms in **Africa/Cairo** time, built with a pure TypeScript domain layer, Signal-based state facade, gateway abstraction, and a reconstructed deterministic local mock server.

---

## Features

- **Day Timeline (`08:00–18:00` Africa/Cairo)**: Interactive room schedule grid with date navigation (`Prev`, `Next`, `Today`, date picker), color- and label-differentiated user reservations, click-to-inspect details, and responsive mobile card fallback.
- **Room Discovery & Filters**: Filter by room name, floor, minimum capacity, and required equipment (`projector`, `whiteboard`, `video`).
- **Booking Drawer**: Accessible slide-over form with inline domain validation, room capacity/equipment hints, loading state, and input preservation on recoverable `500` errors.
- **My Bookings**: View active reservations and cancel with two-step confirmation.
- **409 Conflict Resolution**: On concurrent booking conflicts (`HTTP 409`), refreshes authoritative bookings, generates valid nearest-first alternative slots via `suggestSlots()`, and requires explicit user selection before retrying.
- **Real-Time Event Reconciliation**: Deduplicates `Booked`/`Cancelled` events by `eventId`, buffers out-of-order `seq` events, and triggers snapshot resync on gaps.

---

## Tech Stack

- **Angular 21** (Standalone APIs, Zoneless Change Detection, Signals: `signal()`, `computed()`)
- **TypeScript 5.9** (`strict: true`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`)
- **RxJS 7** (event stream subscription in Data/Store layers only)
- **Vitest 4** + `jsdom` + `@analogjs/vite-plugin-angular` (unit, component, and integration tests)
- **Native `Intl.DateTimeFormat`** (zero external timezone dependencies)

---

## Setup & Commands

### Install
```bash
npm install
```

### Run Development Server
```bash
npm start
# or: npx ng serve
```

### Typecheck
```bash
npm run typecheck
```

### Run Automated Tests
```bash
npm test
# Watch mode:
npm run test:watch
```

### Production Build
```bash
npm run build
```
Build output is written to `dist/room-booking-hub`.

---

## Architecture

- **`src/app/domain/`** — Pure TypeScript rules (`validateBooking`, `findConflicts`, `suggestSlots`, `timezone.ts`). Zero Angular, RxJS, DOM, or `Date.now()` dependencies.
- **`src/app/data/`** — `BookingGateway` interface & `BOOKING_GATEWAY` token, `LocalMockGateway`, DTO runtime validation/mapping, and `BookingEventReconciler`.
- **`src/app/infrastructure/mock-server/`** — Reconstructed deterministic in-memory `MockServer` (isolated from domain and UI).
- **`src/app/state/`** — `BookingHubStore` (Angular Signals facade) and `APP_CLOCK` injection token.
- **`src/app/features/booking-hub/`** — Standalone UI components with separate `.ts`, `.html`, `.scss` files.
- **`src/app/shared/a11y/`** — `DialogFocusDirective` for modal focus trapping and restoration.

---

## Mock Server Usage

Because the assessment's `mock-server.ts` was not supplied, `src/app/infrastructure/mock-server/mock-server.ts` was reconstructed from the specification. In `src/app/app.config.ts`, `BOOKING_GATEWAY` is bound to `LocalMockGateway` backed by `MockServer`:
- Simulates `200`/`201` responses, atomic `409` overlap/buffer conflicts, `404` not found, and injectable `500`/malformed faults for testing.
- Emits `Booked` and `Cancelled` events with global monotonic `seq` numbers.

---

## Known Limitations & Engineering Notes

- **Reconstructed Mock Server**: The assessment's `mock-server.ts` was not included; `src/app/infrastructure/mock-server/mock-server.ts` was reconstructed from the task description.
- **In-memory persistence**: Refreshing the browser resets `MockServer` to its seeded state.
- **No live browser E2E runner**: Automated UI/integration tests run in `jsdom` via Vitest and Angular `TestBed`.
- **No ESLint script**: Strict TypeScript (`tsc --noEmit`) is enforced, but ESLint is not configured in `package.json`.

### Measured Performance Note (60 Rooms × 30 Days)
- `src/app/domain/rules/performance.spec.ts` benchmarks `validateBooking()` + `suggestSlots()` over **60 rooms × 30 days (1,800 active bookings)** by pre-indexing intervals by `roomId`, pre-filtering eligible rooms, and early-exiting once `limit` nearest slots are found.
- **Measured Vitest execution time**: **73 ms** total for the benchmark suite.

### Moving to WebSocket + Real Backend (Idempotency & Ordering)
1. **Gateway swap**: Implement `HttpWsBookingGateway implements BookingGateway` using `HttpClient` for commands/snapshots and a WebSocket/SSE stream for `events$`, then swap `BOOKING_GATEWAY` in `src/app/app.config.ts`.
2. **Idempotency**: Attach client-generated `Idempotency-Key` headers on `POST /bookings` and `DELETE /bookings/:id` retries; keep `eventId` deduplication in `BookingEventReconciler`.
3. **Ordering**: Use per-room or global monotonic `seq` numbers with snapshot+watermark resync on gaps (`needsResync` -> `GET /bookings?date=`).


