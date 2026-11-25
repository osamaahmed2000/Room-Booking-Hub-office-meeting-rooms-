import { describe, expect, it } from 'vitest';
import { Booking, BookingRequest, Room } from '../models/booking.types';
import { validateRecurringBooking } from './recurring-booking';

const ROOM_A: Room = {
  id: 'room-a',
  name: 'Nile',
  floor: 1,
  capacity: 6,
  equipment: ['projector'],
};

const NOW = new Date('2026-11-25T07:00:00+02:00');

describe('Day-2: validateRecurringBooking (weekly up to 4 weeks, all-or-nothing)', () => {
  const baseReq: BookingRequest = {
    roomId: 'room-a',
    userId: 'user-1',
    title: 'Weekly Sync',
    start: new Date('2026-11-25T09:00:00+02:00'),
    end: new Date('2026-11-25T10:00:00+02:00'),
    attendees: 4,
    needs: ['projector'],
  };

  it('accepts 4 weekly occurrences when all weeks are valid and conflict-free', () => {
    const res = validateRecurringBooking(baseReq, 4, ROOM_A, [], [], NOW);
    expect(res.ok).toBe(true);
    expect(res.occurrences).toHaveLength(4);
    expect(res.failedWeeks).toHaveLength(0);
    expect(res.occurrences.map((o) => o.date)).toEqual([
      '2026-11-25',
      '2026-12-02',
      '2026-12-09',
      '2026-12-16',
    ]);
  });

  it('rejects all-or-nothing and identifies the exact failed week when week 3 conflicts', () => {
    const existing: Booking[] = [
      {
        id: 'bk-w3',
        roomId: 'room-a',
        userId: 'user-2',
        title: 'Week 3 Conflict',
        start: '2026-12-09T09:30:00+02:00',
        end: '2026-12-09T10:30:00+02:00',
        attendees: 2,
        needs: [],
        status: 'confirmed',
      },
    ];

    const res = validateRecurringBooking(baseReq, 4, ROOM_A, existing, [], NOW);
    expect(res.ok).toBe(false);
    expect(res.failedWeeks).toHaveLength(1);
    expect(res.failedWeeks[0]?.weekIndex).toBe(3);
    expect(res.failedWeeks[0]?.date).toBe('2026-12-09');
    expect(res.failedWeeks[0]?.errors.map((e) => e.code)).toContain('ROOM_CONFLICT');
  });

  it('rejects recurring weeks > 4 or < 1', () => {
    const tooMany = validateRecurringBooking(baseReq, 5, ROOM_A, [], [], NOW);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.failedWeeks[0]?.errors.map((e) => e.code)).toContain(
      'INVALID_RECURRENCE_WEEKS',
    );
  });
});

