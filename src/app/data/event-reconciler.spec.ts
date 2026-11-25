import { describe, expect, it } from 'vitest';
import { Booking, BookingEvent } from '../domain';
import { BookingEventReconciler } from './event-reconciler';

function makeBooking(id: string, status: 'confirmed' | 'cancelled' = 'confirmed'): Booking {
  return {
    id,
    roomId: 'room-nile',
    userId: 'user-osama',
    title: `Meeting ${id}`,
    start: '2026-11-25T13:00:00+02:00',
    end: '2026-11-25T14:00:00+02:00',
    attendees: 3,
    needs: [],
    status,
  };
}

describe('BookingEventReconciler', () => {
  it('buffers out-of-order future seq events and drains them in order when gap closes', () => {
    const reconciler = new BookingEventReconciler();
    let state: Booking[] = [];

    const evt2: BookingEvent = {
      type: 'Cancelled',
      eventId: 'e-2',
      seq: 2,
      booking: makeBooking('bk-1', 'cancelled'),
    };
    const evt1: BookingEvent = {
      type: 'Booked',
      eventId: 'e-1',
      seq: 1,
      booking: makeBooking('bk-1', 'confirmed'),
    };

    // Arrive seq=2 before seq=1
    const r1 = reconciler.apply(state, evt2);
    expect(r1.applied).toBe(false);
    expect(r1.needsResync).toBe(true);
    state = r1.bookings;
    expect(state).toHaveLength(0);

    // Arrive seq=1 -> drains seq=1 then seq=2 in order
    const r2 = reconciler.apply(state, evt1);
    expect(r2.applied).toBe(true);
    expect(r2.bookings).toHaveLength(1);
    expect(r2.bookings[0]?.status).toBe('cancelled');
    expect(reconciler.currentSeq).toBe(2);
  });

  it('does not blindly discard an unseen lower-seq event if it updates an entity with no newer seq', () => {
    const reconciler = new BookingEventReconciler();
    // Snapshot was at seq 5, containing bk-1
    let state: Booking[] = [makeBooking('bk-1', 'confirmed')];
    reconciler.reset(5, state);

    // Delayed unseen event for another booking bk-2 at seq 4
    const delayedEvt: BookingEvent = {
      type: 'Booked',
      eventId: 'e-4',
      seq: 4,
      booking: makeBooking('bk-2', 'confirmed'),
    };

    const res = reconciler.apply(state, delayedEvt);
    expect(res.applied).toBe(true);
    expect(res.bookings.map((b) => b.id)).toEqual(['bk-1', 'bk-2']);
  });

  it('is idempotent on duplicate eventIds', () => {
    const reconciler = new BookingEventReconciler();
    const evt: BookingEvent = {
      type: 'Booked',
      eventId: 'e-1',
      seq: 1,
      booking: makeBooking('bk-1', 'confirmed'),
    };

    const r1 = reconciler.apply([], evt);
    const r2 = reconciler.apply(r1.bookings, evt);
    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(false);
    expect(r2.bookings).toHaveLength(1);
  });
});

