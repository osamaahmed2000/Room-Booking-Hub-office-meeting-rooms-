import {
  Booking,
  BookingRequest,
  DEFAULT_OFFICE_POLICY,
} from '../models/booking.types';
import { parseInstantInput, parseIsoInstant } from '../utils/timezone';

/**
 * Deduplicates bookings by stable `id` (last occurrence wins if duplicated).
 */
export function deduplicateBookings(bookings: readonly Booking[]): Booking[] {
  const byId = new Map<string, Booking>();
  for (const booking of bookings) {
    byId.set(booking.id, booking);
  }
  return Array.from(byId.values());
}

/**
 * Finds all active (`status === 'confirmed'`) bookings in the same room that overlap
 * the candidate interval `[start, end)` expanded by `bufferMins` on both sides.
 */
export function findConflicts(
  req: BookingRequest,
  existing: readonly Booking[],
  bufferMins: number = DEFAULT_OFFICE_POLICY.bufferMinutes,
): Booking[] {
  const bufferMs = bufferMins * 60_000;

  const candStart = parseInstantInput(req.start);
  const candEnd = parseInstantInput(req.end);
  if (!candStart.ok || !candEnd.ok || candEnd.value <= candStart.value) {
    return [];
  }

  const deduped = deduplicateBookings(existing);
  const conflicts: Booking[] = [];

  for (const item of deduped) {
    if (item.status === 'cancelled') continue;
    if (item.roomId !== req.roomId) continue;
    if (req.editingBookingId && item.id === req.editingBookingId) continue;

    const exStart = parseIsoInstant(item.start);
    const exEnd = parseIsoInstant(item.end);
    if (!exStart.ok || !exEnd.ok) continue;

    if (
      candStart.value < exEnd.value + bufferMs &&
      candEnd.value > exStart.value - bufferMs
    ) {
      conflicts.push(item);
    }
  }

  return conflicts;
}
