# Test & Verification Report

## Executed Commands (After Final Code Edit)

| Check | Command | Result | Details |
| --- | --- | --- | --- |
| Strict TypeScript | `npm run typecheck` (`tsc --noEmit`) | **PASS** | Exit code `0` |
| Production Build | `npm run build` (`ng build`) | **PASS** | `248.66 kB` initial (`63.63 kB` est. transfer), output in `dist/room-booking-hub` |
| Automated Test Suite | `npm test` (`vitest run` v4.1.12) | **PASS** | **12 test files passed, 60 tests passed (0 failed, 0 skipped)** in `6.56s` |

---

## Test Breakdown by File

1. `src/app/domain/utils/timezone.spec.ts` — **5 passed** (ISO `Z`/`+02:00`/`+03:00` normalization, date-only/naive rejection, winter/summer Cairo projection, spring-forward nonexistent local time, fall-back ambiguous local time)
2. `src/app/domain/rules/conflict-detection.spec.ts` — **4 passed** (overlap & missing buffer, exact 15m buffer before/after, different rooms & cancelled exclusion, duplicate IDs)
3. `src/app/domain/rules/booking-validation.spec.ts` — **13 passed** (valid booking, past booking, Sun–Thu, Fri/Sat, 08:00/18:00 boundaries, before/after hours, 15m/120m durations, reversed interval, crossing midnight, capacity, all equipment types, 3/day quota + cancelled exclusion, precedence order, Cairo summer & DST transition day)
4. `src/app/domain/rules/slot-suggestion.spec.ts` — **2 passed** (nearest-first deterministic ordering + deduplication + `validateBooking` re-check, never past or Fri/Sat)
5. `src/app/data/event-reconciler.spec.ts` — **3 passed** (out-of-order buffering & draining, unseen lower-`seq` entity update, `eventId` idempotency)
6. `src/app/data/local-mock.gateway.spec.ts` — **9 passed** (GET 200/500, POST 201 + `Booked` event, POST 409 conflict payload, POST 500, cancel 200/404/500, malformed 200/409 payloads, duplicate `eventId`, malformed snapshot timestamps & 400 server interval)
7. `src/app/state/booking-hub.store.spec.ts` — **10 passed** (init, GET 500, validation rejection without gateway call, create, 409 conflict + suggestions, POST 500, cancel success & failure, duplicate submit prevention, real-time/duplicate/out-of-order events, stale date-switch response discarding)
8. `src/app/app.component.spec.ts` — **3 passed** (timeline render, My Bookings tab, ConflictDialog alertdialog & disabled retry until alternative chosen)
9. `src/app/shared/a11y/dialog-focus.directive.spec.ts` — **1 passed** (initial focus & `Tab`/`Shift+Tab` focus trap)
10. `src/app/integration/booking-hub.integration.spec.ts` — **7 passed** (end-to-end scenarios 1–10 including race condition, dirty duplicate records, and retry after 500)

---

## Issues Encountered & Fixed During Testing

- **Vitest + Angular `@Injectable` compilation**: Resolved by aligning `vitest@^4.1.12`, `@angular/build@21`, `@analogjs/vite-plugin-angular`, and `src/test-setup.ts`.
- **Offline `ng build` font failure**: Removed external Google Fonts `<link>` in `src/index.html`.
- **Duplicate API records & spurious `needsResync`**: Fixed in `BookingHubStore.loadBookings()` and `BookingEventReconciler.reconcileMutation()`.

---

## Known Untested Behavior

- **Live browser rendering**: No Playwright/Cypress run against a real Chromium viewport was executed; CSS media queries, visual contrast, and real browser scroll/focus behavior were verified by code inspection and `jsdom` tests only.
- **ESLint**: Not configured in `package.json`.

