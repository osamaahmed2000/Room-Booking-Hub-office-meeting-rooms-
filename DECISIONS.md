# Architecture & Design Decision Log

## 1. Framework-Free Domain Layer
- **Context**: Business rules (validation, conflicts, suggestions, Cairo DST) must be testable without Angular DI/DOM and reusable across layers.
- **Options**: (A) Put rules in Angular services; (B) Pure TypeScript functions in `src/app/domain/`.
- **Chosen**: **B** — Pure TypeScript with zero `@angular/*`, `rxjs`, or browser imports.
- **Why**: Instant unit test execution, zero framework coupling, enforced explicit `nowMs` injection.
- **Trade-offs**: Store must act as a thin adapter injecting `APP_CLOCK`.
- **Evidence**: `src/app/domain/` (24 passing unit tests).

## 2. Angular Signals vs RxJS for State
- **Context**: Manage reactive UI state and real-time event streams.
- **Options**: (A) Pure RxJS `BehaviorSubject` store; (B) Angular Signals (`signal`, `computed`) for state + RxJS `Observable` only for `events$`.
- **Chosen**: **B**.
- **Why**: Signals provide synchronous, glitch-free derived state (`availableRooms`, `roomTimelineData`, `bookingCounts`) without manual `async` pipes or subscription boilerplate; RxJS remains ideal for push event streams.
- **Trade-offs**: Event stream subscription still requires `takeUntilDestroyed(destroyRef)`.
- **Evidence**: `src/app/state/booking-hub.store.ts` (10 store tests).

## 3. Gateway Abstraction (`BookingGateway` + `BOOKING_GATEWAY`)
- **Context**: Provided `mock-server.ts` was missing and must be replaceable with a real HTTP backend later.
- **Options**: (A) Direct `MockServer` calls from Store; (B) `BookingGateway` interface bound via `InjectionToken`.
- **Chosen**: **B**.
- **Why**: Dependency inversion allows swapping `LocalMockGateway` for `HttpBookingGateway` in `app.config.ts` with zero Store/UI changes.
- **Trade-offs**: Requires DTO mapping boilerplate in `booking.dto.ts`.
- **Evidence**: `src/app/data/booking.gateway.ts`, `src/app/data/local-mock.gateway.ts`.

## 4. Validation Precedence (Ordered Multi-Error List)
- **Context**: A draft can violate multiple rules simultaneously (e.g., Friday + outside hours + over capacity).
- **Options**: (A) Stop on first error; (B) Return all independent errors in strict precedence order, short-circuiting only when timestamps/intervals fail to parse.
- **Chosen**: **B**.
- **Why**: Gives users complete feedback in one submit while preventing misleading downstream checks on unparseable dates.
- **Trade-offs**: Slightly more structured error rendering in `BookingDrawer`.
- **Evidence**: `booking-validation.spec.ts` precedence test.

## 5. Buffer Semantics (Symmetric 15-Minute Buffer)
- **Context**: A 15-minute buffer is required between bookings in the same room.
- **Options**: (A) Overlap only; (B) Symmetric expansion `[eStart - 15m, eEnd + 15m)`.
- **Chosen**: **B** — `cStart < eEnd + 15m && cEnd > eStart - 15m`.
- **Why**: Guarantees 15 minutes both after an existing meeting and before the next existing meeting.
- **Trade-offs**: Exact adjacency (e.g. `10:00` after `09:00–10:00`) is rejected as `ROOM_CONFLICT`.
- **Evidence**: `conflict-detection.spec.ts` and integration test #4.

## 6. Daily Quota Day Definition
- **Context**: Users are limited to 3 active bookings per day across all rooms.
- **Options**: (A) UTC calendar date; (B) `Africa/Cairo` local start date.
- **Chosen**: **B** — Cairo local start date (`getZonedDateTimeParts(startMs, 'Africa/Cairo').date`).
- **Why**: Aligns with Cairo office business days and prevents UTC midnight (`22:00 UTC` = `00:00 Cairo`) off-by-one errors.
- **Trade-offs**: Requires timezone projection on every active booking during quota count.
- **Evidence**: `booking-validation.spec.ts` quota tests.

## 7. Cairo Timezone & DST Strategy
- **Context**: `Africa/Cairo` observes DST (`+02:00` winter, `+03:00` summer). External libraries should be avoided unless necessary.
- **Options**: (A) Add `luxon`/`date-fns-tz`; (B) Native `Intl.DateTimeFormat` with explicit DST gap/fold probing.
- **Chosen**: **B**.
- **Why**: Zero bundle overhead, accurate IANA tzdata in V8/Node/browsers, and `resolveLocalDateTimeToInstant` explicitly detects `NONEXISTENT_LOCAL_TIME` and `AMBIGUOUS_LOCAL_TIME` without silent shifting.
- **Trade-offs**: Relies on host/browser ICU tzdata.
- **Evidence**: `timezone.spec.ts` (spring-forward `2026-04-24` and fall-back `2026-10-29` tests).

## 8. Cancelled Bookings Exclusion
- **Context**: Cancelled bookings remain in history/snapshots.
- **Chosen**: Exclude `status === 'cancelled'` from `findConflicts`, daily quota, `activeBookings`, `myBookings`, and `roomTimelineData`.
- **Why**: Cancelled rooms are free and should not block users or count against daily limits.
- **Evidence**: `booking-validation.spec.ts`, `conflict-detection.spec.ts`, integration test #5.

## 9. Duplicate IDs & Events
- **Context**: Dirty API responses or at-least-once event streams can emit duplicate records/events.
- **Chosen**: `deduplicateBookings` by `id` in domain & Store `loadBookings`; `seenEventIds` Set in `LocalMockGateway` and `BookingEventReconciler`.
- **Evidence**: `event-reconciler.spec.ts`, `local-mock.gateway.spec.ts`, integration test #7 & #8.

## 10. Out-of-Order Event Reconciliation
- **Context**: Events carry global monotonic `seq` numbers and full `Booking` snapshots, and may arrive out of order.
- **Chosen**: Buffer future `seq > lastSeq + 1` in `pending` and drain contiguous runs; for unseen lower-`seq` events, apply only if `seq > lastEntitySeq.get(booking.id)` and flag `needsResync` on gaps.
- **Why**: Never blindly discards valid state changes while avoiding stale overwrites.
- **Evidence**: `event-reconciler.spec.ts`, `booking-hub.store.spec.ts`.

## 11. HTTP 409 Conflict Handling
- **Context**: Concurrent users can race on the same slot.
- **Chosen**: Preserve server `conflicts`, refresh `loadBookings(affectedDate)`, re-run domain validation, compute `suggestSlots()`, and open `ConflictDialog` requiring explicit user choice before retry.
- **Evidence**: `booking-hub.store.spec.ts`, `app.component.spec.ts`, integration test #6.

## 12. Alternative Slot Suggestions
- **Context**: When a slot is unavailable, suggest valid alternatives.
- **Chosen**: Search `workdayStartMinute..workdayEndMinute` in `15m` steps across `horizonDays`, validate every candidate through `validateBooking()`, deduplicate, and sort by `(distanceMinutes ASC, start ASC, requestedRoomFirst, roomId ASC)`.
- **Evidence**: `slot-suggestion.spec.ts`.

## 13. Deterministic Testing (`APP_CLOCK` & `nowMs`)
- **Context**: Time-sensitive tests flake if they read `Date.now()`.
- **Chosen**: Inject `nowMs` into all domain functions and `APP_CLOCK` into `BookingHubStore`.
- **Evidence**: All 57 tests use fixed timestamps and pass deterministically.

