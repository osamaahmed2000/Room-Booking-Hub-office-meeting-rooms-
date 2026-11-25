import {
  Booking,
  BookingRequest,
  DEFAULT_OFFICE_POLICY,
  OfficePolicy,
  Room,
  SlotSuggestion,
} from '../models/booking.types';
import {
  addDaysToDateString,
  formatLocalSlotToIsoUtc,
  getZonedDateTimeParts,
  parseInstantInput,
  parseIsoInstant,
} from '../utils/timezone';
import { deduplicateBookings } from './conflict-detection';
import { validateBooking } from './booking-validation';

interface ParsedInterval {
  startMs: number;
  endMs: number;
}

/**
 * Suggests valid, conflict-free booking slots nearest to the requested start time.
 * Pre-indexes bookings by roomId and pre-parses timestamps so 60 rooms x 30 days
 * runs in a few milliseconds while preserving exact `validateBooking` semantics.
 */
export function suggestSlots(
  req: BookingRequest,
  rooms: readonly Room[],
  existing: readonly Booking[],
  now: Date,
  limit: number = 3,
  policy: OfficePolicy = DEFAULT_OFFICE_POLICY,
  horizonDays: number = 3,
): SlotSuggestion[] {
  if (limit <= 0) return [];

  const parsedStart = parseInstantInput(req.start);
  const parsedEnd = parseInstantInput(req.end);
  if (!parsedStart.ok || !parsedEnd.ok || parsedEnd.value <= parsedStart.value) {
    return [];
  }

  const durationMinutes = Math.round((parsedEnd.value - parsedStart.value) / 60_000);
  if (
    durationMinutes < policy.minDurationMinutes ||
    durationMinutes > policy.maxDurationMinutes
  ) {
    return [];
  }

  const nowMs = now.getTime();
  const requestedStartMs = parsedStart.value;
  const startLocal = getZonedDateTimeParts(requestedStartMs, policy.timezone);
  const nowLocal = getZonedDateTimeParts(nowMs, policy.timezone);
  const baseDate = startLocal.date < nowLocal.date ? nowLocal.date : startLocal.date;

  // Pre-filter eligible rooms and order requested room first, then by id
  const eligibleRooms = rooms
    .filter(
      (r) =>
        r.capacity >= req.attendees &&
        (req.needs ?? []).every((eq) => r.equipment.includes(eq)),
    )
    .sort((a, b) => {
      if (a.id === req.roomId && b.id !== req.roomId) return -1;
      if (b.id === req.roomId && a.id !== req.roomId) return 1;
      return a.id.localeCompare(b.id);
    });

  if (eligibleRooms.length === 0) return [];

  // Pre-deduplicate and index active bookings by roomId + user daily counts
  const deduped = deduplicateBookings(existing);
  const byRoom = new Map<string, ParsedInterval[]>();
  const userDateCounts = new Map<string, number>();

  for (const b of deduped) {
    if (b.status === 'cancelled') continue;
    if (req.editingBookingId && b.id === req.editingBookingId) continue;

    const bStart = parseIsoInstant(b.start);
    const bEnd = parseIsoInstant(b.end);
    if (!bStart.ok || !bEnd.ok) continue;

    let list = byRoom.get(b.roomId);
    if (!list) {
      list = [];
      byRoom.set(b.roomId, list);
    }
    list.push({ startMs: bStart.value, endMs: bEnd.value });

    if (b.userId === req.userId) {
      const d = getZonedDateTimeParts(bStart.value, policy.timezone).date;
      userDateCounts.set(d, (userDateCounts.get(d) ?? 0) + 1);
    }
  }

  const bufferMs = policy.bufferMinutes * 60_000;
  const userBookings = deduped.filter((b) => b.userId === req.userId);
  const candidates: SlotSuggestion[] = [];
  const seenKeys = new Set<string>();

  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset++) {
    const candidateDate = addDaysToDateString(baseDate, dayOffset);
    if ((userDateCounts.get(candidateDate) ?? 0) >= policy.maxActiveBookingsPerDay) {
      continue;
    }

    const middayIso = formatLocalSlotToIsoUtc(candidateDate, 12 * 60, policy.timezone);
    if (!middayIso.ok) continue;
    const weekday = getZonedDateTimeParts(
      Date.parse(middayIso.value),
      policy.timezone,
    ).weekdayIndex;
    const hoursWindow = policy.dayHours[weekday];
    if (!hoursWindow) continue;

    for (
      let minute = hoursWindow.startMinute;
      minute + durationMinutes <= hoursWindow.endMinute;
      minute += policy.slotStepMinutes
    ) {
      const startIsoRes = formatLocalSlotToIsoUtc(candidateDate, minute, policy.timezone);
      const endIsoRes = formatLocalSlotToIsoUtc(
        candidateDate,
        minute + durationMinutes,
        policy.timezone,
      );
      if (!startIsoRes.ok || !endIsoRes.ok) continue;

      const candStartMs = Date.parse(startIsoRes.value);
      const candEndMs = Date.parse(endIsoRes.value);
      if (candStartMs < nowMs) continue;

      const distanceMinutes = Math.abs(candStartMs - requestedStartMs) / 60_000;

      // Early exit if we already have `limit` candidates and this slot is strictly farther
      if (candidates.length >= limit) {
        const worstTopDistance = candidates
          .map((c) => c.distanceMinutes)
          .sort((a, b) => a - b)[limit - 1]!;
        if (distanceMinutes > worstTopDistance) {
          if (candStartMs > requestedStartMs) break;
          continue;
        }
      }

      for (const room of eligibleRooms) {
        const roomIntervals = byRoom.get(room.id);
        const hasConflict =
          roomIntervals?.some(
            (iv) =>
              candStartMs < iv.endMs + bufferMs && candEndMs > iv.startMs - bufferMs,
          ) ?? false;

        if (hasConflict) continue;

        const key = `${room.id}|${startIsoRes.value}|${endIsoRes.value}`;
        if (seenKeys.has(key)) continue;

        // Final authoritative verification against validateBooking
        const check = validateBooking(
          {
            ...req,
            roomId: room.id,
            start: new Date(startIsoRes.value),
            end: new Date(endIsoRes.value),
          },
          room,
          roomIntervals ? deduped.filter((b) => b.roomId === room.id) : [],
          userBookings,
          now,
          policy,
        );

        if (check.ok) {
          seenKeys.add(key);
          const reason =
            distanceMinutes === 0 && room.id !== req.roomId
              ? 'alternative_room_same_time'
              : room.id === req.roomId
                ? 'same_room_nearest_slot'
                : 'alternative_room_nearest_slot';

          candidates.push({
            roomId: room.id,
            start: new Date(startIsoRes.value),
            end: new Date(endIsoRes.value),
            reason,
            distanceMinutes,
          });
        }
      }

      if (dayOffset === 0 && candidates.length >= limit && candStartMs >= requestedStartMs) {
        // Still allow earlier/symmetric slots on day 0; full sort handles exact order
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.distanceMinutes !== b.distanceMinutes) {
      return a.distanceMinutes - b.distanceMinutes;
    }
    const startDiff = a.start.getTime() - b.start.getTime();
    if (startDiff !== 0) return startDiff;
    if (a.roomId === req.roomId && b.roomId !== req.roomId) return -1;
    if (b.roomId === req.roomId && a.roomId !== req.roomId) return 1;
    return a.roomId.localeCompare(b.roomId);
  });

  return candidates.slice(0, limit);
}
