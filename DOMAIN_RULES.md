# Domain Rules & Validation Specification

All business rules live in `src/app/domain/` as pure TypeScript functions with explicit `nowMs` and `OfficePolicy` parameters.

---

## Default Office Policy (`DEFAULT_OFFICE_POLICY`)

| Setting | Value | Notes |
| --- | --- | --- |
| `timezone` | `'Africa/Cairo'` | IANA timezone (`+02:00` winter, `+03:00` summer DST) |
| `workingDays` | `[0, 1, 2, 3, 4]` | Sunday (0) through Thursday (4); Friday (5) & Saturday (6) rejected |
| `workdayStartMinute` | `480` (`08:00`) | Inclusive opening boundary |
| `workdayEndMinute` | `1080` (`18:00`) | Inclusive closing boundary |
| `minDurationMinutes` | `15` | Explicit minimum policy (brief specifies max 2h) |
| `maxDurationMinutes` | `120` | 2-hour maximum |
| `bufferMinutes` | `15` | Required gap between bookings in the same room |
| `maxActiveBookingsPerDay` | `3` | Active `'confirmed'` bookings per user per Cairo calendar day |
| `slotStepMinutes` | `15` | Granularity for `suggestSlots()` |

---

## Validation Precedence (`validateBooking`)

`validateBooking` evaluates rules in strict order and returns all independent errors in precedence order:

1. **Malformed request / invalid timestamps**
   - `INVALID_REQUEST` (missing `roomId` or `userId`)
   - `INVALID_TITLE` (empty/whitespace title)
   - `INVALID_ATTENDEES` (non-integer or `< 1`)
   - `INVALID_TIMESTAMP` (not ISO-8601 with explicit `Z` or `±HH:MM`, or calendar overflow)
   - *Short-circuit*: If `start` or `end` fails parsing, steps 2–9 are skipped.
2. **Invalid interval or duration**
   - `INVALID_INTERVAL` (`endMs <= startMs` — short-circuits steps 3–9)
   - `DURATION_TOO_SHORT` (`< 15` minutes)
   - `DURATION_TOO_LONG` (`> 120` minutes)
3. **Non-working day**
   - `NON_WORKING_DAY` (Cairo local start weekday is Friday or Saturday)
4. **Outside working hours / crossing midnight**
   - `CROSSES_MIDNIGHT` (Cairo local start date ≠ Cairo local end date)
   - `OUTSIDE_WORKING_HOURS` (`startMinute < 480` or `endMinute > 1080`)
5. **Past booking**
   - `BOOKING_IN_PAST` (`startMs < nowMs`)
6. **Missing room**
   - `ROOM_NOT_FOUND` (skips step 7 & step 9)
7. **Capacity & equipment**
   - `CAPACITY_EXCEEDED` (`attendees > room.capacity`)
   - `MISSING_EQUIPMENT` (any `needs` item not in `room.equipment`)
8. **Daily quota**
   - `DAILY_QUOTA_EXCEEDED` (`>= 3` `'confirmed'` bookings for `userId` on the same Cairo local start date across all rooms, excluding `'cancelled'`, `editingBookingId`, and duplicate IDs)
9. **Same-room conflict & buffer**
   - `ROOM_CONFLICT` (via `findConflicts`)

---

## Timezone & DST Semantics (`src/app/domain/utils/timezone.ts`)

- `parseIsoInstant(value)` requires explicit `Z` or `±HH:MM` and verifies calendar bounds via `Date.UTC` round-trip. Date-only (`2026-11-25`) and naive local strings (`2026-11-25T09:00:00`) are rejected.
- All comparisons operate on UTC epoch milliseconds (`number`), never raw strings. Thus `2026-11-25T07:00:00Z`, `2026-11-25T09:00:00+02:00`, and `2026-11-25T10:00:00+03:00` normalize to the exact same instant.
- `resolveLocalDateTimeToInstant(localDateTime, 'Africa/Cairo')` probes surrounding offsets and round-trips through `Intl.DateTimeFormat`:
  - `0` matching instants → `NONEXISTENT_LOCAL_TIME` (e.g., `2026-04-24T00:30:00` during spring-forward).
  - `> 1` matching instants → `AMBIGUOUS_LOCAL_TIME` (e.g., `2026-10-29T23:30:00` during fall-back).

---

## Buffer Semantics (`findConflicts`)

For an active (`status === 'confirmed'`) booking `[eStart, eEnd)` in the same `roomId` and candidate `[cStart, cEnd)` with `bufferMs = 15 * 60_000`:

$$\text{conflict} \iff c_{\text{start}} < e_{\text{end}} + \text{bufferMs} \;\land\; c_{\text{end}} > e_{\text{start}} - \text{bufferMs}$$

### Boundary Examples (Existing `09:00–10:00`)
- `08:00–08:45`: **Allowed** (`08:45 <= 09:00 - 15m`)
- `08:00–08:46`: **Conflict** (14m buffer before)
- `10:00–11:00`: **Conflict** (0m buffer after)
- `10:14–11:14`: **Conflict** (14m buffer after)
- `10:15–11:15`: **Allowed** (`10:15 >= 10:00 + 15m`)
- Different room (`room-b`) or `status: 'cancelled'`: **Allowed**

