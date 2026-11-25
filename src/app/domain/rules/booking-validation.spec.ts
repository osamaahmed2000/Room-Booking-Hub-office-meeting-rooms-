import { describe, expect, it } from 'vitest';
import { Booking, BookingRequest, Room } from '../models/booking.types';
import { validateBooking } from './booking-validation';

const ROOM_A: Room = {
  id: 'room-a',
  name: 'Nile',
  floor: 1,
  capacity: 6,
  equipment: ['projector', 'whiteboard'],
};

const NOW_WINTER = new Date('2026-11-25T07:00:00+02:00');

function makeReq(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    roomId: 'room-a',
    userId: 'user-1',
    title: 'Architecture Sync',
    start: new Date('2026-11-25T09:00:00+02:00'),
    end: new Date('2026-11-25T10:00:00+02:00'),
    attendees: 4,
    needs: ['projector'],
    ...overrides,
  };
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b-1',
    roomId: 'room-a',
    userId: 'user-2',
    title: 'Existing Meeting',
    start: '2026-11-25T09:00:00+02:00',
    end: '2026-11-25T10:00:00+02:00',
    attendees: 3,
    needs: [],
    status: 'confirmed',
    ...overrides,
  };
}

describe('validateBooking', () => {
  it('accepts a valid booking', () => {
    const result = validateBooking(makeReq(), ROOM_A, [], [], NOW_WINTER);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a booking starting before injected now', () => {
    const result = validateBooking(
      makeReq({
        start: '2026-11-25T08:30:00+02:00',
        end: '2026-11-25T09:30:00+02:00',
      }),
      ROOM_A,
      [],
      [],
      new Date('2026-11-25T09:00:00+02:00'),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('BOOKING_IN_PAST');
  });

  it('accepts Sun–Thu (08:00–18:00) and Friday half-day (08:00–13:00), rejects Friday afternoon and Saturday', () => {
    const nowBeforeWeek = new Date('2026-11-22T06:00:00+02:00');
    for (const day of ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) {
      const res = validateBooking(
        makeReq({ start: `${day}T09:00:00+02:00`, end: `${day}T10:00:00+02:00` }),
        ROOM_A,
        [],
        [],
        nowBeforeWeek,
      );
      expect(res.ok).toBe(true);
    }

    // Day-2: Friday half-day 08:00-13:00 allowed
    const fridayMorning = validateBooking(
      makeReq({ start: '2026-11-27T12:00:00+02:00', end: '2026-11-27T13:00:00+02:00' }),
      ROOM_A,
      [],
      [],
      nowBeforeWeek,
    );
    expect(fridayMorning.ok).toBe(true);

    // Day-2: Friday after 13:00 rejected
    const fridayAfternoon = validateBooking(
      makeReq({ start: '2026-11-27T13:00:00+02:00', end: '2026-11-27T14:00:00+02:00' }),
      ROOM_A,
      [],
      [],
      nowBeforeWeek,
    );
    expect(fridayAfternoon.ok).toBe(false);
    expect(fridayAfternoon.errors.map((e) => e.code)).toContain('OUTSIDE_WORKING_HOURS');

    // Saturday rejected as NON_WORKING_DAY
    const saturday = validateBooking(
      makeReq({ start: '2026-11-28T09:00:00+02:00', end: '2026-11-28T10:00:00+02:00' }),
      ROOM_A,
      [],
      [],
      nowBeforeWeek,
    );
    expect(saturday.ok).toBe(false);
    expect(saturday.errors.map((e) => e.code)).toContain('NON_WORKING_DAY');
  });

  it('accepts 08:00 opening and 18:00 closing boundaries, rejects outside hours', () => {
    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T08:00:00+02:00', end: '2026-11-25T09:00:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).ok,
    ).toBe(true);

    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T17:00:00+02:00', end: '2026-11-25T18:00:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).ok,
    ).toBe(true);

    const beforeOpen = validateBooking(
      makeReq({ start: '2026-11-25T07:59:00+02:00', end: '2026-11-25T09:00:00+02:00' }),
      ROOM_A,
      [],
      [],
      new Date('2026-11-25T06:00:00+02:00'),
    );
    expect(beforeOpen.errors.map((e) => e.code)).toContain('OUTSIDE_WORKING_HOURS');

    const afterClose = validateBooking(
      makeReq({ start: '2026-11-25T17:00:00+02:00', end: '2026-11-25T18:01:00+02:00' }),
      ROOM_A,
      [],
      [],
      NOW_WINTER,
    );
    expect(afterClose.errors.map((e) => e.code)).toContain('OUTSIDE_WORKING_HOURS');
  });

  it('enforces 15-minute minimum and 120-minute maximum duration', () => {
    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T09:00:00+02:00', end: '2026-11-25T09:15:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).ok,
    ).toBe(true);

    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T09:00:00+02:00', end: '2026-11-25T09:14:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).errors.map((e) => e.code),
    ).toContain('DURATION_TOO_SHORT');

    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T09:00:00+02:00', end: '2026-11-25T11:00:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).ok,
    ).toBe(true);

    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T09:00:00+02:00', end: '2026-11-25T11:01:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).errors.map((e) => e.code),
    ).toContain('DURATION_TOO_LONG');
  });

  it('rejects reversed interval and crossing midnight', () => {
    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T10:00:00+02:00', end: '2026-11-25T09:00:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).errors.map((e) => e.code),
    ).toContain('INVALID_INTERVAL');

    expect(
      validateBooking(
        makeReq({ start: '2026-11-25T23:30:00+02:00', end: '2026-11-26T00:30:00+02:00' }),
        ROOM_A,
        [],
        [],
        NOW_WINTER,
      ).errors.map((e) => e.code),
    ).toContain('CROSSES_MIDNIGHT');
  });

  it('rejects insufficient capacity and each missing equipment type', () => {
    expect(
      validateBooking(makeReq({ attendees: 7 }), ROOM_A, [], [], NOW_WINTER).errors.map(
        (e) => e.code,
      ),
    ).toContain('CAPACITY_EXCEEDED');

    const bareRoom: Room = { id: 'room-bare', name: 'Bare', floor: 1, capacity: 4, equipment: [] };
    for (const eq of ['projector', 'whiteboard', 'video'] as const) {
      expect(
        validateBooking(
          makeReq({ roomId: 'room-bare', attendees: 2, needs: [eq] }),
          bareRoom,
          [],
          [],
          NOW_WINTER,
        ).errors.map((e) => e.code),
      ).toContain('MISSING_EQUIPMENT');
    }
  });

  it('enforces daily quota of 3 active bookings per user and excludes cancelled', () => {
    const userBookings: Booking[] = [
      makeBooking({ id: 'b-1', roomId: 'room-a', userId: 'user-1', start: '2026-11-25T08:00:00+02:00', end: '2026-11-25T08:30:00+02:00' }),
      makeBooking({ id: 'b-2', roomId: 'room-b', userId: 'user-1', start: '2026-11-25T10:00:00+02:00', end: '2026-11-25T10:30:00+02:00' }),
      makeBooking({ id: 'b-3', roomId: 'room-b', userId: 'user-1', start: '2026-11-25T12:00:00+02:00', end: '2026-11-25T12:30:00+02:00' }),
      makeBooking({ id: 'b-c', roomId: 'room-b', userId: 'user-1', start: '2026-11-25T14:00:00+02:00', end: '2026-11-25T14:30:00+02:00', status: 'cancelled' }),
    ];

    const fourth = validateBooking(
      makeReq({ start: '2026-11-25T15:00:00+02:00', end: '2026-11-25T15:30:00+02:00' }),
      ROOM_A,
      [],
      userBookings,
      NOW_WINTER,
    );
    expect(fourth.errors.map((e) => e.code)).toContain('DAILY_QUOTA_EXCEEDED');

    const withTwoActive = userBookings.filter((b) => b.id !== 'b-3');
    const third = validateBooking(
      makeReq({ start: '2026-11-25T15:00:00+02:00', end: '2026-11-25T15:30:00+02:00' }),
      ROOM_A,
      [],
      withTwoActive,
      NOW_WINTER,
    );
    expect(third.ok).toBe(true);
  });

  it('orders multiple independent errors according to documented precedence', () => {
    const result = validateBooking(
      makeReq({
        start: '2026-11-28T07:00:00+02:00', // Saturday, before hours, in past
        end: '2026-11-28T07:30:00+02:00',
        attendees: 99,
        needs: ['video'],
      }),
      ROOM_A,
      [],
      [],
      new Date('2026-11-29T09:00:00+02:00'),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual([
      'NON_WORKING_DAY',
      'BOOKING_IN_PAST',
      'CAPACITY_EXCEEDED',
      'MISSING_EQUIPMENT',
    ]);
  });

  it('handles Cairo summer DST (+03:00) and fall-back transition day (2026-10-29)', () => {
    expect(
      validateBooking(
        makeReq({ start: '2026-07-01T05:00:00Z', end: '2026-07-01T06:00:00Z' }),
        ROOM_A,
        [],
        [],
        new Date('2026-07-01T04:00:00Z'),
      ).ok,
    ).toBe(true);

    expect(
      validateBooking(
        makeReq({ start: '2026-10-29T05:00:00Z', end: '2026-10-29T06:00:00Z' }),
        ROOM_A,
        [],
        [],
        new Date('2026-10-29T04:00:00Z'),
      ).ok,
    ).toBe(true);
  });
});
