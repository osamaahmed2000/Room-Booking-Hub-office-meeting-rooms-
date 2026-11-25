# AI Usage Log (`AI_USAGE.md`)

This log records actual AI assistance used while building **Room Booking Hub**.

## AI Tools Used
- **Antigravity AI Coding Assistant** (IDE agent)

## Tasks Assisted
1. **Architecture & Documentation**: `ARCHITECTURE.md`, `README.md`, `DECISIONS.md`, `DOMAIN_RULES.md`, `DAY_2_CHANGE_READINESS.md`, `LIVE_REVIEW_PREP.md`, `TEST_REPORT.md`.
2. **Pure TypeScript Domain Layer (TDD)**: `src/app/domain/` (`validateBooking`, `findConflicts`, `suggestSlots`, `validateRecurringBooking`, `timezone.ts`).
3. **Data Layer & Reconstructed Mock Server**: `src/app/data/` and `src/app/infrastructure/mock-server/mock-server.ts` (reconstructed from the task description because the provided `mock-server.ts` was not included).
4. **Signal Store & Angular Standalone UI**: `src/app/state/booking-hub.store.ts`, `src/app/features/booking-hub/`, and `DialogFocusDirective`.

## Cases Where AI Was Wrong & Human/Test Verification Caught It
1. **Missing snapshot deduplication in `BookingHubStore.loadBookings()`**: The initial AI implementation deduplicated bookings inside `domain/` but stored raw `res.value.bookings` in `BookingHubStore`, causing dirty API duplicate IDs to double-count in `activeBookings()` and `bookingCounts()`. Caught during QA audit and fixed with `deduplicateBookings()`.
2. **Spurious `needsResync` on HTTP mutation acks**: The initial `createBooking` / `cancelBooking` synthesized an `ack-...` `BookingEvent` with the same `seq` already emitted by `MockServer`, causing `BookingEventReconciler.apply()` to flag `needsResync = true` on every mutation. Fixed by adding `BookingEventReconciler.reconcileMutation()`.
3. **Unindexed `suggestSlots()` performance on 60 rooms × 30 days**: The initial `suggestSlots()` scanned and re-parsed all 1,800 bookings on every candidate slot, taking **2,847 ms** in `performance.spec.ts`. Fixed by pre-indexing intervals by `roomId`, pre-filtering eligible rooms, and adding an early-exit bound, reducing the benchmark to **73 ms**.
4. **Offline `ng build` Google Fonts failure & Vitest/Angular 21 version mismatch**: Resolved by removing the external font `<link>` in `src/index.html` and aligning `typescript@~5.9.3` and `vitest@^4.1.12`.
