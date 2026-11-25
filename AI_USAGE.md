# AI Usage Log

## Tools Used
- **Antigravity AI Coding Assistant** (used inside the IDE for scaffolding, pure TypeScript domain implementation, Angular Signals store, standalone UI components, and Vitest test suites).

## How I Used AI
1. **Repository Setup & Architecture**: Used AI to scaffold the Angular 21 strict workspace, configure Vitest + `jsdom`, and separate the app into `domain/` (framework-free), `data/`, `infrastructure/mock-server/`, `state/`, and `features/`.
2. **Domain Layer (TDD)**: Wrote failing Vitest tests first for `validateBooking`, `findConflicts`, `suggestSlots`, `validateRecurringBooking`, and `Africa/Cairo` DST edge cases, then generated and refined the pure TypeScript implementation.
3. **Mock Server Reconstruction**: Because the assessment's `mock-server.ts` was not included in my materials, I had AI reconstruct a deterministic in-memory `MockServer` behind `BookingGateway` / `LocalMockGateway` with atomic `409` checks and fault injection.
4. **Store, UI & Day-2 Changes**: Used AI to build `BookingHubStore` (optimistic booking + rollback, 10s Undo cancellation, event reconciliation) and standalone UI components (`DayTimeline`, `BookingDrawer`, `MyBookings`, `ConflictDialog`, `RoomFilters`, `DialogFocusDirective`).

## Where AI Was Wrong (and How I Fixed/Caught It)
1. **Duplicate API records in Store (`loadBookings`)**: AI implemented `deduplicateBookings()` in the domain layer, but forgot to apply it when storing `GET /bookings` snapshots in `BookingHubStore.loadBookings()`. Dirty API responses with duplicate IDs would have double-counted active bookings and daily quota. Caught during the QA audit and fixed with `deduplicateBookings()` + a regression test.
2. **Spurious `needsResync` on HTTP mutation acknowledgments**: In `BookingHubStore.createBooking` and `cancelBooking`, AI initially fed a synthetic `ack-...` event into `BookingEventReconciler.apply()` with the same `seq` that `MockServer` had already emitted on `events$`, causing `needsResync = true` on every mutation. Fixed by adding `BookingEventReconciler.reconcileMutation()`.
3. **Slow `suggestSlots()` on 60 rooms × 30 days**: AI's first `suggestSlots()` implementation re-parsed and deduplicated all 1,800 bookings inside the inner room/slot loop, taking **2,847 ms** in `performance.spec.ts`. After indexing intervals by `roomId`, pre-filtering eligible rooms, and adding an early-exit bound, the benchmark dropped to **63–73 ms**.
4. **Offline `ng build` & toolchain mismatches**: AI initially added a Google Fonts `<link>` in `src/index.html` (which broke offline `ng build` font inlining) and installed incompatible `typescript@7` / `vitest@5` versions with `@angular/build@21`. Both were caught by running `ng build` and `vitest run` and fixed directly.

## Verification & Ownership
- Every requirement, edge case (Cairo DST transitions, 15-minute buffer, quota, 409 rollback, 10s Undo, Day-2 Friday half-day + 4-week recurring), and build/test command (`npm run typecheck`, `npm run build`, `npm test` — 12 files, 60 tests) was executed and verified locally.
