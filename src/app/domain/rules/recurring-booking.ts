import {
  Booking,
  BookingRequest,
  DEFAULT_OFFICE_POLICY,
  OfficePolicy,
  RecurringValidationResult,
  RecurringWeekResult,
  Room,
} from '../models/booking.types';
import {
  addDaysToDateString,
  formatLocalSlotToIsoUtc,
  getZonedDateTimeParts,
  parseInstantInput,
} from '../utils/timezone';
import { validateBooking } from './booking-validation';

/**
 * Day-2 Rule: Validates a weekly recurring booking up to `policy.maxRecurringWeeks` (4 weeks)
 * with all-or-nothing semantics. Projects each week in Africa/Cairo local wall-clock time
 * so DST transitions preserve the local meeting hour.
 */
export function validateRecurringBooking(
  req: BookingRequest,
  weeks: number,
  room: Room | undefined,
  existing: readonly Booking[],
  userBookings: readonly Booking[],
  now: Date,
  policy: OfficePolicy = DEFAULT_OFFICE_POLICY,
): RecurringValidationResult {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > policy.maxRecurringWeeks) {
    const fallbackDate = new Date(now.getTime());
    return {
      ok: false,
      occurrences: [],
      failedWeeks: [
        {
          weekIndex: 1,
          date: '',
          start: fallbackDate,
          end: fallbackDate,
          ok: false,
          errors: [
            {
              code: 'INVALID_RECURRENCE_WEEKS',
              field: 'weeks',
              message: `Recurring weeks must be between 1 and ${policy.maxRecurringWeeks}.`,
            },
          ],
        },
      ],
    };
  }

  const parsedStart = parseInstantInput(req.start);
  const parsedEnd = parseInstantInput(req.end);
  if (!parsedStart.ok || !parsedEnd.ok) {
    const check = validateBooking(req, room, existing, userBookings, now, policy);
    const fallback = new Date(now.getTime());
    const failed: RecurringWeekResult = {
      weekIndex: 1,
      date: '',
      start: fallback,
      end: fallback,
      ok: false,
      errors: check.errors,
    };
    return { ok: false, occurrences: [failed], failedWeeks: [failed] };
  }

  const startParts = getZonedDateTimeParts(parsedStart.value, policy.timezone);
  const endParts = getZonedDateTimeParts(parsedEnd.value, policy.timezone);
  const durationMs = parsedEnd.value - parsedStart.value;

  const occurrences: RecurringWeekResult[] = [];
  const failedWeeks: RecurringWeekResult[] = [];

  for (let w = 1; w <= weeks; w++) {
    const targetDate = addDaysToDateString(startParts.date, (w - 1) * 7);
    const startIsoRes = formatLocalSlotToIsoUtc(
      targetDate,
      startParts.minuteOfDay,
      policy.timezone,
    );

    if (!startIsoRes.ok) {
      const failed: RecurringWeekResult = {
        weekIndex: w,
        date: targetDate,
        start: new Date(parsedStart.value + (w - 1) * 7 * 86_400_000),
        end: new Date(parsedEnd.value + (w - 1) * 7 * 86_400_000),
        ok: false,
        errors: [startIsoRes.error],
      };
      occurrences.push(failed);
      failedWeeks.push(failed);
      continue;
    }

    const occStart = new Date(startIsoRes.value);
    const occEnd =
      startParts.date === endParts.date
        ? new Date(occStart.getTime() + durationMs)
        : new Date(parsedEnd.value + (w - 1) * 7 * 86_400_000);

    const check = validateBooking(
      {
        ...req,
        start: occStart,
        end: occEnd,
      },
      room,
      existing,
      userBookings,
      now,
      policy,
    );

    const weekResult: RecurringWeekResult = {
      weekIndex: w,
      date: targetDate,
      start: occStart,
      end: occEnd,
      ok: check.ok,
      errors: check.errors,
    };

    occurrences.push(weekResult);
    if (!check.ok) {
      failedWeeks.push(weekResult);
    }
  }

  return {
    ok: failedWeeks.length === 0,
    occurrences,
    failedWeeks,
  };
}

