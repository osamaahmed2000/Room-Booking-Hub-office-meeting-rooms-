# Domain Layer Specification (`src/app/domain`)

Pure TypeScript only: zero Angular, RxJS, DOM, `localStorage`, or implicit `Date.now()` usage.

## 1. Validation Precedence (`validateBooking`)

`validateBooking` evaluates rules in strict precedence order and returns `{ valid: boolean; errors: DomainError[] }` containing all independent errors in precedence order:

1. **Malformed request / invalid timestamps**: `INVALID_REQUEST`, `INVALID_TITLE`, `INVALID_ATTENDEES`, `INVALID_TIMESTAMP`.
   - *Short-circuit*: If `start` or `end` fails timestamp parsing, downstream time/room/quota/conflict checks are skipped to avoid misleading errors.
2. **Invalid interval or duration**: `INVALID_INTERVAL` (`end <= start` — short-circuits downstream checks), `DURATION_TOO_SHORT` (`< 15m`), `DURATION_TOO_LONG` (`> 120m`).
3. **Non-working day**: `NON_WORKING_DAY` when Cairo local start date is Friday (`5`) or Saturday (`6`). Working days are Sunday (`0`) through Thursday (`4`).
4. **Outside working hours / crossing midnight**: `CROSSES_MIDNIGHT` when Cairo local start date ≠ end date; `OUTSIDE_WORKING_HOURS` when start < `08:00` or end > `18:00` Cairo local time.
5. **Past booking**: `BOOKING_IN_PAST` when `startMs < nowMs`.
6. **Missing room**: `ROOM_NOT_FOUND` (skips capacity/equipment/same-room conflict checks if room does not exist).
7. **Capacity & equipment**: `CAPACITY_EXCEEDED` (`attendees > room.capacity`), `MISSING_EQUIPMENT`.
8. **Daily quota**: `DAILY_QUOTA_EXCEEDED` when user already has `>= 3` active (`status === 'confirmed'`) bookings on the same Cairo local start date across all rooms (excluding `cancelled`, `editingBookingId`, and duplicate IDs).
9. **Same-room conflict & buffer**: `ROOM_CONFLICT` via `findConflicts`.

## 2. Buffer Semantics (`findConflicts`)

- Applies only to `status === 'confirmed'` bookings in the **same `roomId`**.
- Bookings are deduplicated by stable `id` before evaluation.
- For existing `[eStart, eEnd)` and candidate `[cStart, cEnd)` with `bufferMs = 15 * 60_000`:
  - Conflict occurs iff `cStart < eEnd + bufferMs && cEnd > eStart - bufferMs`.
  - Example: Existing `09:00–10:00` conflicts with `10:00` and `10:14`, and allows `10:15` (and `08:45` end).

## 3. Timezone & DST Strategy (`Africa/Cairo`)

- **Strategy**: Native `Intl.DateTimeFormat` with IANA `Africa/Cairo` (zero external dependencies; Node/V8 ICU tzdata).
- **Instant normalization**: `parseIsoInstant` requires explicit `Z` or `±HH:MM` offset, validates calendar bounds (no silent overflow), and converts to UTC epoch ms. Date-only and naive local strings are rejected.
- **DST transition safety**: `resolveLocalDateTimeToInstant` probes surrounding zone offsets and round-trips through `Intl.DateTimeFormat`:
  - `0` matches → `NONEXISTENT_LOCAL_TIME` (e.g., spring-forward gap `2026-04-24T00:30:00`).
  - `> 1` matches → `AMBIGUOUS_LOCAL_TIME` (e.g., fall-back fold `2026-10-29T23:30:00`).
  - Never silently shifts invalid local wall-clock times.

