import { describe, expect, it } from 'vitest';
import { Booking, Room } from '../models/booking.types';
import { addDaysToDateString } from '../utils/timezone';
import { suggestSlots } from './slot-suggestion';
import { validateBooking } from './booking-validation';

describe('Performance benchmark: 60 rooms x 30 days', () => {
  it('validates and computes suggestions across 60 rooms x 30 days well within interactive budget', () => {
    const rooms: Room[] = Array.from({ length: 60 }, (_, i) => ({
      id: `room-${i + 1}`,
      name: `Room ${i + 1}`,
      floor: (i % 5) + 1,
      capacity: 4 + (i % 4) * 4,
      equipment: i % 2 === 0 ? ['projector', 'whiteboard', 'video'] : ['projector'],
    }));

    const baseDate = '2026-11-25';
    const existing: Booking[] = [];
    for (let d = 0; d < 30; d++) {
      const dateStr = addDaysToDateString(baseDate, d);
      for (let r = 0; r < 60; r++) {
        existing.push({
          id: `bk-${d}-${r}`,
          roomId: rooms[r]!.id,
          userId: `user-${r % 10}`,
          title: `Meeting ${d}-${r}`,
          start: `${dateStr}T09:00:00+02:00`,
          end: `${dateStr}T10:00:00+02:00`,
          attendees: 3,
          needs: ['projector'],
          status: 'confirmed',
        });
      }
    }

    const now = new Date('2026-11-25T07:30:00+02:00');
    const req = {
      roomId: 'room-1',
      userId: 'user-osama',
      title: 'Scale Benchmark',
      start: new Date('2026-11-25T09:00:00+02:00'),
      end: new Date('2026-11-25T10:00:00+02:00'),
      attendees: 4,
      needs: ['projector'] as ('projector' | 'whiteboard' | 'video')[],
    };

    const t0 = performance.now();
    const valRes = validateBooking(req, rooms[0], existing, [], now);
    const suggestions = suggestSlots(req, rooms, existing, now, 3);
    const elapsedMs = performance.now() - t0;

    expect(valRes.ok).toBe(false);
    expect(suggestions).toHaveLength(3);
    // 1,800 bookings across 60 rooms x 30 days should complete quickly (< 500ms even in CI/jsdom)
    expect(elapsedMs).toBeLessThan(500);
  });
});

