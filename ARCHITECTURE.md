# Architecture — Room Booking Hub

## Layer Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│ 1. UI Layer (Standalone Angular Components)                     │
│    AppComponent, DayTimelineComponent, RoomFiltersComponent,    │
│    BookingDrawerComponent, MyBookingsComponent,                 │
│    RoomsDirectoryComponent, ConflictDialogComponent             │
│    - Depends ONLY on BookingHubStore, AppClock, & Domain types  │
│    - MUST NOT call BookingGateway or MockServer directly        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Signals & Intent Methods
┌───────────────────────────────▼─────────────────────────────────┐
│ 2. Store / Facade Layer (Angular Signals)                       │
│    BookingHubStore + APP_CLOCK                                  │
│    - Owns UI-facing state & computed() derivations              │
│    - Injects explicit `nowMs` into Domain functions             │
│    - Coordinates Domain validation + BookingGateway             │
│    - Reconciles real-time events via BookingEventReconciler     │
└──────────────┬────────────────────────────────┬─────────────────┘
               │ Pure Function Calls            │ Async Results & events$
┌──────────────▼────────────────┐  ┌────────────▼─────────────────┐
│ 3. Domain Layer               │  │ 4. Data / Gateway Layer      │
│    (Pure TypeScript ONLY)     │  │    BOOKING_GATEWAY token     │
│    - NO Angular / RxJS / DOM  │  │    BookingGateway interface  │
│    - NO implicit Date.now()   │  │    LocalMockGateway          │
│    - validateBooking()        │  │    booking.dto.ts (mappers)  │
│    - findConflicts()          │  │    BookingEventReconciler    │
│    - suggestSlots()           │  └────────────┬─────────────────┘
│    - timezone.ts (Cairo DST)  │               │ In-process HTTP-like
└───────────────────────────────┘  ┌────────────▼─────────────────┐
                                   │ 5. Local Mock Server         │
                                   │    MockServer                │
                                   │    - Deterministic seed      │
                                   │    - Atomic 409 check        │
                                   │    - Isolated from Domain/UI │
                                   └──────────────────────────────┘
```

---

## Layer Responsibilities

### 1. UI Layer (`src/app/features/`, `src/app/app.component.*`, `src/app/shared/`)
- Renders `DayTimeline`, `RoomFilters`, `BookingDrawer`, `MyBookings`, `RoomsDirectory`, `ConflictDialog`, and booking detail modal.
- Holds only ephemeral local view state (drawer open/closed, form input signals, inline cancel confirmation ID).
- Delegates inline draft validation to `store.validateDraft(draft)` rather than importing or duplicating business rules.
- Uses `DialogFocusDirective` (`appDialogFocus`) for focus trapping, restoration, and accessible `Escape` handling.

### 2. Store / Facade Layer (`src/app/state/`)
- `BookingHubStore` is the single UI-facing state coordinator (`signal()`, `computed()`).
- Reads current time exclusively from `APP_CLOCK` and passes `nowMs` explicitly to `validateBooking()` and `suggestSlots()`.
- Guards against duplicate form submissions (`submitting()`), duplicate cancellations (`cancellingBookingIds()`), and stale date-switch responses (`bookingsRequestSeq`).
- Subscribes to `gateway.events$` using `takeUntilDestroyed(this.destroyRef)`.

### 3. Domain Layer (`src/app/domain/`)
- 100% framework-free pure TypeScript (`no @angular/*`, `no rxjs`, `no window/document`, `no Date.now()`).
- Implements `validateBooking()`, `findConflicts()`, `suggestSlots()`, `deduplicateBookings()`, and `Africa/Cairo` timezone/DST utilities.
- Returns stable machine-readable `DomainErrorCode` values.

### 4. Data / Gateway Layer (`src/app/data/`)
- `BookingGateway` interface + `BOOKING_GATEWAY` `InjectionToken` decouple Store from any transport implementation.
- `LocalMockGateway` translates `MockServer` responses into `GatewayResult<T>` (`conflict`, `server_error`, `not_found`, `malformed_response`) and validates all untrusted payloads via runtime type guards in `booking.dto.ts`.
- `BookingEventReconciler` handles `eventId` deduplication, out-of-order `seq` buffering, per-entity `seq` tracking, and `needsResync` signaling.

### 5. Local Mock Server (`src/app/infrastructure/mock-server/mock-server.ts`)
- Isolated from domain and UI; contains no business policy logic (only storage-level overlap/buffer 409 check and basic interval sanity).
- Provides fault injection hooks (`injectNextFault`, `emitRawEvent`) for deterministic testing.

---

## Dependency Direction

`UI` ──▶ `Store` ──▶ `Domain` ◀── `Data` ──▶ `MockServer`  
*(Domain has zero outgoing dependencies.)*
