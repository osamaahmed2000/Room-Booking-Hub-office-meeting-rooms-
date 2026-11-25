# Day-2 Change Readiness Guide

This document maps how the current **Room Booking Hub** architecture accommodates an unknown Day-2 change request safely, with minimal blast radius and without speculative over-engineering.

---

## 1. Centralized Rules & Extension Points

| Concern | Centralized Location | Current Mechanism |
| --- | --- | --- |
| Office hours, working days, duration, buffer, quota, slot step | `src/app/domain/models/booking.types.ts` | `DEFAULT_OFFICE_POLICY` (`OfficePolicy` injected into domain calls) |
| Equipment union | `src/app/domain/models/booking.types.ts` | `Equipment` type (`'projector' \| 'whiteboard' \| 'video'`) |
| Validation rules & precedence | `src/app/domain/rules/booking-validation.ts` | `validateBooking()` + `DomainErrorCode` |
| Overlap & buffer semantics | `src/app/domain/rules/conflict-detection.ts` | `findConflicts()` + `deduplicateBookings()` |
| Alternative slot search | `src/app/domain/rules/slot-suggestion.ts` | `suggestSlots()` (automatically inherits `validateBooking()` rules) |
| Timezone & DST conversions | `src/app/domain/utils/timezone.ts` | `parseIsoInstant()`, `getZonedDateTimeParts()`, `resolveLocalDateTimeToInstant()` |
| Transport / API boundary | `src/app/data/booking.gateway.ts` | `BookingGateway` interface + `BOOKING_GATEWAY` `InjectionToken` |
| DTO validation & mapping | `src/app/data/booking.dto.ts` | Runtime type guards (`mapRoomDto`, `mapBookingDto`, `mapBookingEventDto`) |
| Clock injection | `src/app/state/clock.token.ts` | `APP_CLOCK` `InjectionToken` |

---

## 2. Likely Impact Map

| Day-2 Change Type | Files Touched | UI Changes Needed? |
| --- | --- | --- |
| **Change working hours** (e.g. `08:00–18:00` → `09:00–17:00`) | `DEFAULT_OFFICE_POLICY` in `booking.types.ts`; `DayTimelineComponent` (`hours` array + `dayStartMinute`/`totalMinutes`) | Only `hours` ruler array in `day-timeline.component.ts` & subtitle text |
| **Change duration limits** (min/max) or **buffer** or **daily quota** | `DEFAULT_OFFICE_POLICY` in `booking.types.ts` | **None** — `BookingDrawer` delegates validation to `store.validateDraft()`, and `suggestSlots()` reads `policy` |
| **Add a new equipment type** | 1. `Equipment` in `booking.types.ts`<br>2. `VALID_EQUIPMENT` in `booking.dto.ts`<br>3. `EQUIPMENT_OPTIONS` in `room-filters.component.ts` & `EQUIPMENT_LIST` in `booking-drawer.component.ts`<br>4. Seed data in `mock-server.ts` | Only adding the label/value entry to the two UI option arrays |
| **Add a new room property** (e.g. `requiresApproval` or `building`) | 1. `Room` in `booking.types.ts`<br>2. `mapRoomDto` in `booking.dto.ts`<br>3. `MockRoomRecord` in `mock-server.ts`<br>4. Display/filter in `room-filters`, `day-timeline`, `rooms-directory` | Only if the property is displayed or filtered |
| **Add a new validation rule** | 1. `DomainErrorCode` in `booking.types.ts`<br>2. `validateBooking()` in `booking-validation.ts` (at the right precedence step) | **None** — `BookingDrawer` renders `validationErrors()` and `fieldErrors()` generically; `suggestSlots()` automatically obeys it |
| **Add/swap gateway or replace `MockServer`** | 1. New `BookingGateway` class (e.g., `HttpBookingGateway`)<br>2. Provider swap in `src/app/app.config.ts` | **None** — Store and UI only depend on `BOOKING_GATEWAY` |

---

## 3. Step-by-Step How-To

### Add a New Validation Rule Without Coupling UI to Domain
1. Add a stable machine-readable code to `DomainErrorCode` in `src/app/domain/models/booking.types.ts`.
2. Write failing unit tests in `src/app/domain/rules/booking-validation.spec.ts` (and `slot-suggestion.spec.ts` if it affects suggestions).
3. Implement the pure rule in `validateBooking()` at the appropriate precedence position, using injected `nowMs` and `policy`.
4. `BookingHubStore.validateDraft()` and `BookingHubStore.createBooking()` already call `validateBooking()`, and `BookingDrawerComponent` renders `DomainError.message` and `DomainError.field` automatically.

### Replace `MockServer` with the Original Server or Real HTTP API
1. Keep `BookingGateway` (`src/app/data/booking.gateway.ts`) and `BOOKING_GATEWAY` (`src/app/data/booking-gateway.token.ts`) unchanged.
2. Create `HttpBookingGateway implements BookingGateway` using Angular `HttpClient` and SSE/WebSocket for `events$`.
3. Reuse `mapRoomsDto`, `mapBookingsSnapshotDto`, `mapBookingMutationDto`, `mapBookingEventDto`, and `mapConflictErrorDto` from `src/app/data/booking.dto.ts` at the HTTP boundary.
4. Update `BOOKING_GATEWAY` in `src/app/app.config.ts`. Delete or keep `mock-server.ts` for offline/unit tests.

### Test a New Rule with TDD
1. **Red**: Add fixed-fixture test cases with explicit `nowMs` in `src/app/domain/rules/*.spec.ts` and run `npm test` to confirm expected failure.
2. **Green**: Implement the smallest pure change in `src/app/domain/`.
3. **Verify**: Run `npm run typecheck; npm test` to confirm domain, data, store, and integration tests all pass.

---

## 4. Regression Test Strategy

After any Day-2 change:
1. Run `npm run typecheck` (`tsc --noEmit`) to catch exhaustive union/DTO/template type mismatches.
2. Run `npm test` (`vitest run`) to verify all 10 suites (domain, data, store, component, a11y, integration).
3. Add a scenario test in `src/app/integration/booking-hub.integration.spec.ts` if the change crosses Store ↔ Gateway ↔ UI boundaries.
4. Run `npm run build` (`ng build`) to verify AOT template compilation and bundle budgets.

---

## 5. Key Risks on Day-2 Changes

- **Template-hardcoded schedule hours**: `DayTimelineComponent.hours` (`8..18`) is currently a static array; changing `workdayStartMinute`/`workdayEndMinute` in `OfficePolicy` requires updating `hours` to match.
- **Server-client rule drift**: `MockServer.createBooking` only checks interval sanity and 15-minute buffer overlap; if a Day-2 rule must also be enforced server-side (e.g., new conflict condition), update both `validateBooking()` and the server/API contract.
- **DTO strictness**: `booking.dto.ts` rejects unknown `equipment` or `status` values (`null` → `malformed_response`). Any new enum value added by a backend must be added to `VALID_EQUIPMENT` / `mapBookingDto` before deployment.

---

## 6. Safe Implementation Procedure

1. Read the Day-2 requirement and identify affected layers using the Impact Map above.
2. Update domain types & write failing TDD unit tests first.
3. Implement domain rule → update DTOs/MockServer if contract changed → update Store/UI only if new state or controls are needed.
4. Run `npm run typecheck`, `npm run build`, and `npm test` after the final edit.
5. Update `DOMAIN_RULES.md`, `DECISION_LOG.md`, and `TEST_REPORT.md` to match.

