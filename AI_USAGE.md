# AI Usage Log

## Tools Used
- **Antigravity AI Coding Assistant** (used inside the IDE for scaffolding, pure TypeScript domain logic, Angular Signals store, standalone UI components, and Vitest test suites).

## How I Used AI
1. **Architecture & Scaffolding**: Used AI to structure the Angular 21 strict workspace, configure Vitest + `jsdom`, and isolate `domain/` (pure TypeScript) from `data/`, `infrastructure/mock-server/`, `state/`, and `features/`.
2. **Mock Server Reconstruction**: Because the assessment's `mock-server.ts` was not included in my materials, I had AI reconstruct a deterministic in-memory `MockServer` behind `BookingGateway` / `LocalMockGateway` with atomic `409` checks and fault injection.
3. **Store, UI & Day-2 Features**: Used AI to implement `BookingHubStore` (optimistic booking + rollback, 10s Undo cancellation, event reconciliation) and standalone UI components (`DayTimeline`, `BookingDrawer`, `MyBookings`, `ConflictDialog`, `RoomFilters`, `DialogFocusDirective`).
4. **Git History Note**: The main implementation was built first and then committed into logical layer-by-layer commits; subsequent fixes (such as `package.json`, `test-setup.ts`, UI recurring test, and this log) were committed incrementally as they were made.

## Where AI Was Wrong (Before / After)
1. **Duplicate API records in `BookingHubStore.loadBookings()`**:
   - *Before*: `deduplicateBookings()` was used in `domain/`, but `loadBookings()` stored `res.value.bookings` directly without deduplicating, which allowed duplicate IDs from a dirty API snapshot to double-count in `activeBookings()` and daily quota.
   - *After*: Applied `deduplicateBookings(res.value.bookings)` inside `loadBookings()` before updating state and added a regression test in `booking-hub.integration.spec.ts`.
2. **Spurious `needsResync` on HTTP mutation acknowledgments**:
   - *Before*: `createBooking()` and `cancelBooking()` synthesized an `ack-...` `BookingEvent` and passed it to `BookingEventReconciler.apply()` with the same `seq` already emitted by `MockServer`, causing `needsResync = true` on every mutation.
   - *After*: Added `BookingEventReconciler.reconcileMutation()` so HTTP acknowledgments reconcile state without triggering false gap resyncs.
3. **Slow `suggestSlots()` on 60 rooms × 30 days**:
   - *Before*: `suggestSlots()` scanned and re-parsed all bookings inside the inner room/slot loop, making the 60 rooms × 30 days benchmark fail its `< 500 ms` threshold.
   - *After*: Pre-indexed active intervals by `roomId`, pre-filtered eligible rooms, and added an early-exit bound so the benchmark passes well under `500 ms` (~`60 ms`).
4. **Offline `ng build` & `package.json` dependency drift**:
   - *Before*: `src/index.html` included an external Google Fonts `<link>` that failed offline `ng build` font inlining, and `package.json` was missing the Angular 21 dependencies present in `package-lock.json` (which would break `npm ci`).
   - *After*: Removed the external font link and aligned `package.json` with `package-lock.json`.

## Decisions I Made Myself
- **Minimum 15-minute booking duration**: The brief specified a 2-hour maximum without a minimum; I chose a 15-minute minimum matching `slotStepMinutes` and buffer granularity.
- **Validation precedence**: Ordered checks from structural/timestamp parsing → interval/duration → working day/hours → past → room/capacity/equipment → daily quota → room conflict, returning all independent errors while short-circuiting on unparseable timestamps.
- **Cairo local start date for daily quota**: Assigned bookings to their `Africa/Cairo` start date rather than UTC date so late-evening UTC timestamps don't shift days.
- **Kept `MockServer` isolated behind `BookingGateway`**: Ensured swapping to a real HTTP/WebSocket backend only requires replacing `BOOKING_GATEWAY` in `app.config.ts`.
