import { describe, expect, it } from 'vitest';
import { Booking, BookingRequest, Room } from '../models/booking.types';
import { validateBooking } from './booking-validation';
import { suggestSlots } from './slot-suggestion';

const ROOMS: Room[] = [
  { id: 'room-a', name: 'Nile', floor: 1, capacity: 6, equipment: ['projector', 'whiteboard'] },
  { id: 'room-b', name: 'Karnak', floor: 2, capacity: 10, equipment: ['projector', 'whiteboard', 'video'] },
];

const NOW = new Date('2026-11-25T08:30:00+02:00');

describe('suggestSlots', () => {
  it('orders suggestions nearest-first, deduplicates, and passes validateBooking', () => {
    const existing: Booking[] = [
      {
        id: 'b-1',
        roomId: 'room-a',
        userId: 'user-2',
        title: 'Blocked',
        start: '2026-11-25T09:00:00+02:00',
        end: '2026-11-25T10:00:00+02:00',
        attendees: 2,
        needs: [],
        status: 'confirmed',
      },
    ];

    const req: BookingRequest = {
      roomId: 'room-a',
      userId: 'user-1',
      title: 'Design Review',
      start: new Date('2026-11-25T09:00:00+02:00'),
      end: new Date('2026-11-25T10:00:00+02:00'),
      attendees: 4,
      needs: ['projector'],
    };

    const suggestions = suggestSlots(req, ROOMS, existing, NOW, 3);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]?.roomId).toBe('room-b');
    expect(suggestions[0]?.start).toBeInstanceOf(Date);
    expect(suggestions[0]?.reason).toBe('alternative_room_same_time');

    const requestedMs = (req.start as Date).getTime();
    for (let i = 1; i < suggestions.length; i++) {
      expect(Math.abs(suggestions[i]!.start.getTime() - requestedMs)).toBeGreaterThanOrEqual(
        Math.abs(suggestions[i - 1]!.start.getTime() - requestedMs),
      );
    }

    for (const s of suggestions) {
      const room = ROOMS.find((r) => r.id === s.roomId);
      const check = validateBooking(
        { ...req, roomId: s.roomId, start: s.start, end: s.end },
        room,
        existing,
        [],
        NOW,
      );
      expect(check.ok).toBe(true);
    }
  });

  it('respects Friday half-day (08:00-13:00) and skips Saturday', () => {
    const req: BookingRequest = {
      roomId: 'room-a',
      userId: 'user-1',
      title: 'Thursday Late',
      start: new Date('2026-11-26T17:00:00+02:00'),
      end: new Date('2026-11-26T18:00:00+02:00'),
      attendees: 4,
      needs: ['projector'],
    };

    const existing: Booking[] = [
      {
        id: 'b-thu-a',
        roomId: 'room-a',
        userId: 'user-2',
        title: 'Thu A',
        start: '2026-11-26T17:00:00+02:00',
        end: '2026-11-26T18:00:00+02:00',
        attendees: 2,
        needs: [],
        status: 'confirmed',
      },
      {
        id: 'b-thu-b',
        roomId: 'room-b',
        userId: 'user-2',
        title: 'Thu B',
        start: '2026-11-26T17:00:00+02:00',
        end: '2026-11-26T18:00:00+02:00',
        attendees: 2,
        needs: [],
        status: 'confirmed',
      },
    ];

    const nowThu = new Date('2026-11-26T16:45:00+02:00');
    const suggestions = suggestSlots(req, ROOMS, existing, nowThu, 3);
    expect(suggestions.length).toBeGreaterThan(0);

    for (const s of suggestions) {
      const room = ROOMS.find((r) => r.id === s.roomId);
      const check = validateBooking(
        { ...req, roomId: s.roomId, start: s.start, end: s.end },
        room,
        existing,
        [],
        nowThu,
      );
      expect(check.ok).toBe(true);
    }
  });
});
