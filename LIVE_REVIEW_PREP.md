# Live Review Prep — 20 Technical Interview Questions

### 1. Why keep the domain layer pure TypeScript (framework-free)?
Pure TypeScript functions (`validateBooking`, `findConflicts`, `suggestSlots`) have zero coupling to Angular, RxJS, or the DOM. They run in milliseconds in Vitest, are trivial to reason about, and can be shared with a Node/edge backend without rewriting business rules.

### 2. Why follow strict TDD for the domain layer?
Writing failing tests first forces explicit contracts, boundary definitions (like `08:00`, `18:00`, `15m` buffer, DST transitions), and deterministic `nowMs` injection before implementation begins.

### 3. Why Angular Signals for Store state instead of pure RxJS?
`signal()` and `computed()` provide synchronous, glitch-free derived state (`availableRooms`, `roomTimelineData`, `bookingCounts`) with minimal boilerplate in templates, while RxJS is reserved for asynchronous push streams (`events$`).

### 4. What is the Gateway pattern?
`BookingGateway` defines an application-owned interface (`getRooms`, `getBookings`, `createBooking`, `cancelBooking`, `events$`) returning normalized `GatewayResult<T>` values. The Store depends only on the interface, never on `MockServer` or `HttpClient` directly.

### 5. How is dependency inversion applied here?
High-level modules (`BookingHubStore`) depend on abstractions (`BOOKING_GATEWAY` `InjectionToken` and `APP_CLOCK`), while low-level infrastructure (`LocalMockGateway` + `MockServer`) implements those abstractions and is wired at the composition root (`app.config.ts`).

### 6. How is validation precedence handled?
`validateBooking()` checks rules in strict order (1–9): malformed/timestamp parsing → interval/duration → non-working day → working hours/midnight → past → missing room → capacity/equipment → daily quota → same-room conflict/buffer. Parsing/interval failures short-circuit downstream checks to avoid misleading errors, while independent errors are returned in precedence order.

### 7. How is interval overlap calculated?
Two half-open intervals `[aStart, aEnd)` and `[bStart, bEnd)` overlap iff `aStart < bEnd && aEnd > bStart`.

### 8. Why does exact adjacency (e.g., 10:00 after 09:00–10:00) fail?
The 15-minute buffer expands the existing booking's blocked window to `[eStart - 15m, eEnd + 15m)`. Thus `10:00 < 10:15` triggers `ROOM_CONFLICT`; `10:15` is the earliest allowed start.

### 9. How is daily quota calculated?
We project each active (`status === 'confirmed'`) booking's `start` instant into `Africa/Cairo` local date, deduplicate by `id`, filter by `userId`, and count across all rooms. `>= 3` rejects a 4th booking.

### 10. Why ignore cancelled bookings?
Cancelled reservations release the room and user quota, so they must not block other meetings in `findConflicts()` or count toward the 3-booking daily limit.

### 11. What is a race condition in room booking?
Two users validate the same empty slot on their clients simultaneously and both submit `POST`. Without server-side atomic checking, both would succeed and double-book the room.

### 12. Why HTTP 409?
`409 Conflict` signals that the request could not be completed due to a resource state conflict. On `409`, our Store never retries the same slot or shows success; it refreshes bookings, re-runs validation, computes `suggestSlots()`, and opens `ConflictDialog`.

### 13. How are alternative slots generated?
`suggestSlots()` scans 15-minute steps within `08:00–18:00` across `horizonDays`, validates every candidate with `validateBooking()` (so capacity, equipment, quota, buffer, and working days are all respected), deduplicates, and sorts nearest-first.

### 14. What is idempotency?
Applying the same operation or event multiple times produces the exact same state as applying it once.

### 15. How are duplicate events handled?
Both `LocalMockGateway.events$` and `BookingEventReconciler` track seen `eventId`s in a `Set` and ignore any repeated `eventId`.

### 16. How are out-of-order events handled?
`BookingEventReconciler` buffers future `seq > lastSeq + 1` events and drains contiguous runs when gaps close. For unseen lower-`seq` events, it checks per-entity `lastEntitySeq` so valid earlier updates aren't blindly dropped, and flags `needsResync` to trigger an authoritative snapshot refresh when gaps occur.

### 17. Why compare instants instead of ISO strings?
Lexicographical string comparison fails across offsets (`2026-11-25T07:00:00Z` vs `2026-11-25T09:00:00+02:00` represent the exact same instant). Converting to UTC epoch milliseconds makes comparisons exact.

### 18. What is Africa/Cairo DST?
Egypt switches between `UTC+02:00` (winter) and `UTC+03:00` (summer). Hardcoding `+02:00` breaks summer/transition-day schedules by 1 hour.

### 19. How are ambiguous and nonexistent local times handled?
`resolveLocalDateTimeToInstant()` probes surrounding zone offsets and round-trips through `Intl.DateTimeFormat`. Zero matches return `NONEXISTENT_LOCAL_TIME` (spring-forward gap); multiple matches return `AMBIGUOUS_LOCAL_TIME` (fall-back fold), without silently shifting.

### 20. What changes when a real backend is supplied?
Implement `HttpBookingGateway` (using Angular `HttpClient` + WebSocket/SSE for `events$`), reuse `booking.dto.ts` mappers, and swap the `BOOKING_GATEWAY` provider in `app.config.ts`. Domain, Store, and UI remain unchanged.

