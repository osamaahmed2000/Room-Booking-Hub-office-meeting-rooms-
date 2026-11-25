import {
  Booking,
  BookingRequest,
  DEFAULT_OFFICE_POLICY,
  DomainError,
  OfficePolicy,
  Room,
  ValidationResult,
  WorkingHoursWindow,
} from '../models/booking.types';
import {
  getZonedDateTimeParts,
  parseInstantInput,
  parseIsoInstant,
} from '../utils/timezone';
import { deduplicateBookings, findConflicts, getBufferMins } from './conflict-detection';

export function getWorkingWindow(
  weekdayIndex: number,
  policy: OfficePolicy = DEFAULT_OFFICE_POLICY,
): WorkingHoursWindow | undefined {
  return policy.dayHours[weekdayIndex];
}

/**
 * Validates a booking request against all business rules in strict precedence order:
 * 1. Malformed request / invalid timestamps
 * 2. Invalid interval or duration
 * 3. Non-working day (Cairo; Sun-Thu full, Fri half-day 08:00-13:00, Sat closed)
 * 4. Outside working hours / crossing midnight (Cairo)
 * 5. Past booking (start < now)
 * 6. Missing room
 * 7. Capacity and equipment
 * 8. Daily quota (active bookings on Cairo local start date)
 * 9. Same-room conflict and 15-minute buffer
 */
export function validateBooking(
  req: BookingRequest,
  room: Room | undefined,
  existing: readonly Booking[],
  userBookings: readonly Booking[],
  now: Date,
  policy: OfficePolicy = DEFAULT_OFFICE_POLICY,
): ValidationResult {
  const errors: DomainError[] = [];
  const nowMs = now.getTime();

  // 1. Malformed request / invalid timestamps
  if (!req || typeof req.roomId !== 'string' || !req.roomId.trim()) {
    errors.push({
      code: 'INVALID_REQUEST',
      field: 'roomId',
      message: 'A valid roomId is required.',
    });
  }
  if (!req || typeof req.userId !== 'string' || !req.userId.trim()) {
    errors.push({
      code: 'INVALID_REQUEST',
      field: 'userId',
      message: 'A valid userId is required.',
    });
  }
  if (!req || typeof req.title !== 'string' || !req.title.trim()) {
    errors.push({
      code: 'INVALID_TITLE',
      field: 'title',
      message: 'Booking title is required.',
    });
  }
  if (
    !req ||
    typeof req.attendees !== 'number' ||
    !Number.isInteger(req.attendees) ||
    req.attendees < 1
  ) {
    errors.push({
      code: 'INVALID_ATTENDEES',
      field: 'attendees',
      message: 'Attendees must be a positive integer.',
    });
  }

  const parsedStart = parseInstantInput(req?.start ?? '');
  if (!parsedStart.ok) {
    errors.push({ ...parsedStart.error, field: 'start' });
  }
  const parsedEnd = parseInstantInput(req?.end ?? '');
  if (!parsedEnd.ok) {
    errors.push({ ...parsedEnd.error, field: 'end' });
  }

  if (!parsedStart.ok || !parsedEnd.ok) {
    return { ok: false, errors };
  }

  const startMs = parsedStart.value;
  const endMs = parsedEnd.value;

  // 2. Invalid interval or duration
  if (endMs <= startMs) {
    errors.push({
      code: 'INVALID_INTERVAL',
      field: 'end',
      message: 'End time must be strictly after start time.',
    });
    return { ok: false, errors };
  }

  const durationMinutes = (endMs - startMs) / 60_000;
  if (durationMinutes < policy.minDurationMinutes) {
    errors.push({
      code: 'DURATION_TOO_SHORT',
      field: 'end',
      message: `Booking duration must be at least ${policy.minDurationMinutes} minutes.`,
      meta: { minMinutes: policy.minDurationMinutes, actualMinutes: durationMinutes },
    });
  } else if (durationMinutes > policy.maxDurationMinutes) {
    errors.push({
      code: 'DURATION_TOO_LONG',
      field: 'end',
      message: `Booking duration cannot exceed ${policy.maxDurationMinutes} minutes.`,
      meta: { maxMinutes: policy.maxDurationMinutes, actualMinutes: durationMinutes },
    });
  }

  // 3. Non-working day & 4. Outside working hours / crossing midnight
  const startLocal = getZonedDateTimeParts(startMs, policy.timezone);
  const endLocal = getZonedDateTimeParts(endMs, policy.timezone);
  const hoursWindow = getWorkingWindow(startLocal.weekdayIndex, policy);

  if (!hoursWindow) {
    errors.push({
      code: 'NON_WORKING_DAY',
      field: 'start',
      message: 'Bookings are only allowed Sunday through Friday in Cairo time.',
      meta: { date: startLocal.date, weekday: startLocal.weekdayIndex },
    });
  }

  if (startLocal.date !== endLocal.date) {
    errors.push({
      code: 'CROSSES_MIDNIGHT',
      field: 'end',
      message: 'Bookings cannot cross midnight in Cairo time.',
      meta: { startDate: startLocal.date, endDate: endLocal.date },
    });
  } else if (
    hoursWindow &&
    (startLocal.minuteOfDay < hoursWindow.startMinute ||
      endLocal.minuteOfDay > hoursWindow.endMinute)
  ) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const openStr = `${pad(Math.floor(hoursWindow.startMinute / 60))}:${pad(hoursWindow.startMinute % 60)}`;
    const closeStr = `${pad(Math.floor(hoursWindow.endMinute / 60))}:${pad(hoursWindow.endMinute % 60)}`;
    errors.push({
      code: 'OUTSIDE_WORKING_HOURS',
      field: startLocal.minuteOfDay < hoursWindow.startMinute ? 'start' : 'end',
      message: `Bookings on this day must fall within ${openStr}–${closeStr} Cairo local time.`,
    });
  }

  // 5. Past booking
  if (Number.isFinite(nowMs) && startMs < nowMs) {
    errors.push({
      code: 'BOOKING_IN_PAST',
      field: 'start',
      message: 'Booking cannot start in the past.',
    });
  }

  // 6. Missing room
  if (!room || room.id !== req.roomId) {
    errors.push({
      code: 'ROOM_NOT_FOUND',
      field: 'roomId',
      message: `Room "${req.roomId}" was not found.`,
    });
  } else {
    // 7. Capacity and equipment
    if (typeof req.attendees === 'number' && req.attendees > room.capacity) {
      errors.push({
        code: 'CAPACITY_EXCEEDED',
        field: 'attendees',
        message: `Room capacity (${room.capacity}) is smaller than ${req.attendees} attendees.`,
        meta: { capacity: room.capacity, attendees: req.attendees },
      });
    }

    const missingEquipment = (req.needs ?? []).filter(
      (item) => !room.equipment.includes(item),
    );
    if (missingEquipment.length > 0) {
      errors.push({
        code: 'MISSING_EQUIPMENT',
        field: 'needs',
        message: `Room is missing required equipment: ${missingEquipment.join(', ')}.`,
        meta: { missing: missingEquipment },
      });
    }
  }

  // 8. Daily quota (active bookings for user on Cairo local start date)
  const dedupedUserBookings = deduplicateBookings(
    userBookings.length > 0 ? userBookings : existing,
  );
  const activeTodayCount = dedupedUserBookings.filter((b) => {
    if (b.status === 'cancelled') return false;
    if (req.editingBookingId && b.id === req.editingBookingId) return false;
    if (b.userId !== req.userId) return false;
    const bStart = parseIsoInstant(b.start);
    if (!bStart.ok) return false;
    const bLocal = getZonedDateTimeParts(bStart.value, policy.timezone);
    return bLocal.date === startLocal.date;
  }).length;

  if (activeTodayCount >= policy.maxActiveBookingsPerDay) {
    errors.push({
      code: 'DAILY_QUOTA_EXCEEDED',
      field: 'userId',
      message: `User has reached the daily limit of ${policy.maxActiveBookingsPerDay} active bookings.`,
      meta: { date: startLocal.date, limit: policy.maxActiveBookingsPerDay },
    });
  }

  // 9. Same-room conflict and buffer
  if (room && room.id === req.roomId) {
    const conflicts = findConflicts(req, existing, getBufferMins(room, policy));
    if (conflicts.length > 0) {
      errors.push({
        code: 'ROOM_CONFLICT',
        field: 'start',
        message: 'Room is unavailable or violates the 15-minute buffer.',
        meta: { conflictIds: conflicts.map((c) => c.id) },
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
