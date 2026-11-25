import { describe, expect, it } from 'vitest';
import { Booking, BookingRequest } from '../models/booking.types';
import { findConflicts } from './conflict-detection';

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b-1',
    roomId: 'room-a',
    userId: 'user-1',
    title: 'Standup',
    start: '2026-11-25T09:00:00+02:00',
    end: '2026-11-25T10:00:00+02:00',
    attendees: 3,
    needs: [],
    status: 'confirmed',
    ...overrides,
  };
}

function makeReq(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    roomId: 'room-a',
    userId: 'user-1',
    title: 'Candidate',
    start: '2026-11-25T09:00:00+02:00',
    end: '2026-11-25T10:00:00+02:00',
    attendees: 2,
    needs: [],
    ...overrides,
  };
}

describe('findConflicts', () => {
  it('detects same-room overlap and missing 15-minute buffer', () => {
    const existing = [makeBooking()];

    expect(
      findConflicts(
        makeReq({ start: '2026-11-25T09:30:00+02:00', end: '2026-11-25T10:30:00+02:00' }),
        existing,
        15,
      ),
    ).toHaveLength(1);

    expect(
      findConflicts(
        makeReq({ start: '2026-11-25T10:00:00+02:00', end: '2026-11-25T11:00:00+02:00' }),
        existing,
        15,
      ),
    ).toHaveLength(1);

    expect(
      findConflicts(
        makeReq({ start: '2026-11-25T10:14:00+02:00', end: '2026-11-25T11:14:00+02:00' }),
        existing,
        15,
      ),
    ).toHaveLength(1);
  });

  it('allows exact 15-minute buffer before and after existing booking', () => {
    const existing = [makeBooking()];

    expect(
      findConflicts(
        makeReq({ start: '2026-11-25T08:00:00+02:00', end: '2026-11-25T08:45:00+02:00' }),
        existing,
        15,
      ),
    ).toHaveLength(0);

    expect(
      findConflicts(
        makeReq({ start: '2026-11-25T10:15:00+02:00', end: '2026-11-25T11:15:00+02:00' }),
        existing,
        15,
      ),
    ).toHaveLength(0);
  });

  it('does not conflict with different rooms or cancelled bookings', () => {
    const existing = [
      makeBooking({ id: 'b-other-room', roomId: 'room-b' }),
      makeBooking({ id: 'b-cancelled', roomId: 'room-a', status: 'cancelled' }),
    ];

    expect(findConflicts(makeReq(), existing, 15)).toHaveLength(0);
  });

  it('deduplicates booking records by stable booking ID and supports Date inputs', () => {
    const existing = [
      makeBooking({ id: 'b-dup', start: '2026-11-25T07:00:00Z', end: '2026-11-25T08:00:00Z' }),
      makeBooking({ id: 'b-dup', start: '2026-11-25T09:00:00+02:00', end: '2026-11-25T10:00:00+02:00' }),
    ];

    const conflicts = findConflicts(
      makeReq({
        start: new Date('2026-11-25T09:30:00+02:00'),
        end: new Date('2026-11-25T10:30:00+02:00'),
      }),
      existing,
      15,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe('b-dup');
  });
});
