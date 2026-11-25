import '@angular/compiler';
import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOKING_GATEWAY,
  BookingGateway,
  BookingMutationResult,
  BookingsSnapshot,
  GatewayResult,
  LocalMockGateway,
} from '../data';
import { Booking, BookingDraft, BookingEvent, Room } from '../domain';
import { MockServer } from '../infrastructure/mock-server/mock-server';
import { BookingHubStore } from './booking-hub.store';
import { APP_CLOCK } from './clock.token';

const FIXED_NOW_MS = Date.parse('2026-11-25T07:30:00+02:00');

function createTestStore(options?: {
  gateway?: BookingGateway;
  nowMs?: number;
}) {
  const server = new MockServer();
  const gateway = options?.gateway ?? new LocalMockGateway(server);
  const envInjector = createEnvironmentInjector(
    [
      { provide: BOOKING_GATEWAY, useValue: gateway },
      { provide: APP_CLOCK, useValue: { nowMs: () => options?.nowMs ?? FIXED_NOW_MS } },
      BookingHubStore,
    ],
    null as unknown as EnvironmentInjector,
  );
  const store = envInjector.get(BookingHubStore);
  return { store, server, gateway, envInjector };
}

describe('BookingHubStore', () => {
  const injectorsToDestroy: EnvironmentInjector[] = [];

  afterEach(() => {
    while (injectorsToDestroy.length > 0) {
      injectorsToDestroy.pop()?.destroy();
    }
  });

  function setup(options?: { gateway?: BookingGateway; nowMs?: number }) {
    const ctx = createTestStore(options);
    injectorsToDestroy.push(ctx.envInjector);
    return ctx;
  }

  it('loads rooms and bookings on initialize using Africa/Cairo date', async () => {
    const { store } = setup();
    expect(store.selectedDate()).toBe('2026-11-25');

    await store.initialize();

    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.rooms().length).toBeGreaterThan(0);
    expect(store.bookings().length).toBe(2);
    expect(store.activeBookings().length).toBe(2);
    expect(store.myBookings().length).toBe(1);
    expect(store.bookingCounts().myActiveOnSelectedDate).toBe(1);
    expect(store.bookingCounts().quotaRemaining).toBe(2);
    expect(store.canCreateBooking()).toBe(true);
  });

  it('sets error state on GET 500 failure', async () => {
    const { store, server } = setup();
    server.injectNextFault('GET_ROOMS', {
      kind: 'server_error',
      status: 500,
      message: 'Rooms unavailable',
    });

    await store.loadRooms();

    expect(store.loading()).toBe(false);
    expect(store.error()?.kind).toBe('server_error');
    expect(store.error()?.message).toBe('Rooms unavailable');
  });

  it('rejects invalid booking via domain validation without calling gateway', async () => {
    const { store, gateway } = setup();
    await store.initialize();
    const spy = vi.spyOn(gateway, 'createBooking');

    const outcome = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Saturday Meeting',
      start: '2026-11-28T09:00:00+02:00', // Saturday -> non-working day
      end: '2026-11-28T10:00:00+02:00',
      attendees: 2,
      needs: [],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === 'validation') {
      expect(outcome.errors.map((e) => e.code)).toContain('NON_WORKING_DAY');
    } else {
      throw new Error('Expected validation rejection');
    }
    expect(spy).not.toHaveBeenCalled();
    expect(store.submitting()).toBe(false);
  });

  it('creates a valid booking and reconciles state', async () => {
    const { store } = setup();
    await store.initialize();

    const outcome = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Design Sync',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 4,
      needs: ['projector'],
    });

    expect(outcome.ok).toBe(true);
    expect(store.submitting()).toBe(false);
    expect(store.bookings().some((b) => b.title === 'Design Sync')).toBe(true);
    expect(store.bookingCounts().myActiveOnSelectedDate).toBe(2);
  });

  it('handles 409 conflict by refreshing bookings and populating suggestedSlots', async () => {
    const { store, server } = setup();
    await store.initialize();

    // Simulate another user booking room-nile 13:00-14:00 directly on server
    await server.createBooking({
      roomId: 'room-nile',
      userId: 'user-other',
      title: 'Raced Booking',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 3,
      needs: [],
    });

    // Clear store's local knowledge of that raced booking to simulate stale client before POST
    store.bookings.set(store.bookings().filter((b) => b.title !== 'Raced Booking'));

    const outcome = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'My Sync',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 4,
      needs: ['projector'],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === 'conflict') {
      expect(outcome.details.conflicts.length).toBeGreaterThan(0);
      expect(outcome.suggestions.length).toBeGreaterThan(0);
    } else {
      throw new Error('Expected conflict outcome');
    }

    expect(store.conflictDetails()).not.toBeNull();
    expect(store.suggestedSlots().length).toBeGreaterThan(0);
    // Refreshed state now includes the raced booking
    expect(store.bookings().some((b) => b.title === 'Raced Booking')).toBe(true);
    expect(store.submitting()).toBe(false);
  });

  it('handles POST 500 without mutating bookings and resets submitting', async () => {
    const { store, server } = setup();
    await store.initialize();
    const beforeCount = store.bookings().length;

    server.injectNextFault('POST_BOOKING', {
      kind: 'server_error',
      status: 500,
      message: 'Database error',
    });

    const outcome = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Will Fail',
      start: '2026-11-25T15:00:00+02:00',
      end: '2026-11-25T16:00:00+02:00',
      attendees: 3,
      needs: [],
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === 'gateway_error') {
      expect(outcome.error.kind).toBe('server_error');
    } else {
      throw new Error('Expected gateway_error');
    }
    expect(store.error()?.kind).toBe('server_error');
    expect(store.bookings().length).toBe(beforeCount);
    expect(store.submitting()).toBe(false);
  });

  it('cancels a booking and updates quota/active state, and rolls back nothing on failure', async () => {
    const { store, server } = setup();
    await store.initialize();

    const ok = await store.cancelBooking('bk-seed-2');
    expect(ok).toBe(true);
    expect(store.cancellingBookingIds().has('bk-seed-2')).toBe(false);
    expect(store.myBookings().length).toBe(0);
    expect(store.bookingCounts().quotaRemaining).toBe(3);

    // Failure case: bk-seed-1 stays confirmed
    server.injectNextFault('DELETE_BOOKING', {
      kind: 'server_error',
      status: 500,
      message: 'Cancel failed',
    });
    const failed = await store.cancelBooking('bk-seed-1');
    expect(failed).toBe(false);
    expect(store.error()?.kind).toBe('server_error');
    expect(store.activeBookings().some((b) => b.id === 'bk-seed-1')).toBe(true);
    expect(store.cancellingBookingIds().has('bk-seed-1')).toBe(false);
  });

  it('prevents duplicate concurrent submissions', async () => {
    const { store } = setup();
    await store.initialize();

    const draft: BookingDraft = {
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Double Click Test',
      start: '2026-11-25T15:00:00+02:00',
      end: '2026-11-25T16:00:00+02:00',
      attendees: 2,
      needs: [],
    };

    const p1 = store.createBooking(draft);
    const p2 = store.createBooking(draft);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.reason).toBe('duplicate_submission');
    }
  });

  it('applies real-time events, ignores duplicates, and triggers refresh on out-of-order gaps', async () => {
    const { store, gateway } = setup();
    await store.initialize();
    const refreshSpy = vi.spyOn(store, 'refreshBookings');

    const newBooking: Booking = {
      id: 'bk-live-1',
      roomId: 'room-alex',
      userId: 'user-sara',
      title: 'Live Event',
      start: '2026-11-25T14:00:00+02:00',
      end: '2026-11-25T15:00:00+02:00',
      attendees: 2,
      needs: ['video'],
      status: 'confirmed',
    };

    // seq 1 arrives normally
    store.handleBookingEvent({
      type: 'Booked',
      eventId: 'evt-live-1',
      seq: 1,
      booking: newBooking,
    });
    expect(store.bookings().some((b) => b.id === 'bk-live-1')).toBe(true);

    // Duplicate eventId ignored
    store.handleBookingEvent({
      type: 'Booked',
      eventId: 'evt-live-1',
      seq: 1,
      booking: newBooking,
    });
    expect(store.bookings().filter((b) => b.id === 'bk-live-1')).toHaveLength(1);

    // Out-of-order seq 3 arrives (gap at seq 2) -> triggers refreshBookings
    store.handleBookingEvent({
      type: 'Cancelled',
      eventId: 'evt-live-3',
      seq: 3,
      booking: { ...newBooking, status: 'cancelled' },
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    void gateway;
  });

  it('discards stale loadBookings responses when switching dates rapidly', async () => {
    let resolveFirst!: (val: GatewayResult<BookingsSnapshot>) => void;
    const events$ = new Subject<BookingEvent>();

    const slowGateway: BookingGateway = {
      events$: events$.asObservable(),
      getRooms: async () => ({ ok: true, value: [] as Room[] }),
      getBookings: (date: string) => {
        if (date === '2026-11-25') {
          return new Promise((res) => {
            resolveFirst = res;
          });
        }
        return Promise.resolve({
          ok: true,
          value: {
            seq: 10,
            bookings: [
              {
                id: 'bk-nov26',
                roomId: 'room-nile',
                userId: 'user-osama',
                title: 'Nov 26 Booking',
                start: '2026-11-26T09:00:00+02:00',
                end: '2026-11-26T10:00:00+02:00',
                attendees: 2,
                needs: [],
                status: 'confirmed',
              },
            ],
          },
        });
      },
      createBooking: async (): Promise<GatewayResult<BookingMutationResult>> => ({
        ok: false,
        error: { kind: 'server_error', status: 500, message: 'unused', retryable: true, operation: 'createBooking' },
      }),
      cancelBooking: async (): Promise<GatewayResult<BookingMutationResult>> => ({
        ok: false,
        error: { kind: 'server_error', status: 500, message: 'unused', retryable: true, operation: 'cancelBooking' },
      }),
    };

    const { store } = setup({ gateway: slowGateway });

    const p1 = store.selectDate('2026-11-25');
    const p2 = store.selectDate('2026-11-26');
    await p2;

    // Now resolve the stale 2026-11-25 response
    resolveFirst({
      ok: true,
      value: {
        seq: 1,
        bookings: [
          {
            id: 'bk-stale-nov25',
            roomId: 'room-nile',
            userId: 'user-osama',
            title: 'Stale Nov 25',
            start: '2026-11-25T09:00:00+02:00',
            end: '2026-11-25T10:00:00+02:00',
            attendees: 2,
            needs: [],
            status: 'confirmed',
          },
        ],
      },
    });
    await p1;

    expect(store.selectedDate()).toBe('2026-11-26');
    expect(store.bookings().map((b) => b.id)).toEqual(['bk-nov26']);
  });

  it('supports 10s Undo cancellation with fake timers and commits DELETE after 10s if not undone', async () => {
    vi.useFakeTimers();
    try {
      const { store, gateway } = setup();
      await store.initialize();
      const cancelSpy = vi.spyOn(gateway, 'cancelBooking');

      expect(store.myBookings().some((b) => b.id === 'bk-seed-2')).toBe(true);
      store.requestCancelWithUndo('bk-seed-2', 10_000);

      expect(store.myBookings().some((b) => b.id === 'bk-seed-2')).toBe(false);
      expect(store.pendingUndoCancellations()).toHaveLength(1);
      expect(cancelSpy).not.toHaveBeenCalled();

      // Undo before 10s -> restores without calling server DELETE
      store.undoPendingCancel('bk-seed-2');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(store.myBookings().some((b) => b.id === 'bk-seed-2')).toBe(true);
      expect(cancelSpy).not.toHaveBeenCalled();

      // Now cancel and let 10s expire -> commits server DELETE
      store.requestCancelWithUndo('bk-seed-2', 10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(cancelSpy).toHaveBeenCalledWith('bk-seed-2');
      expect(store.pendingUndoCancellations()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates 4-week recurring bookings all-or-nothing and rolls back if any week fails', async () => {
    const { store, server } = setup();
    await store.initialize();

    // Put a conflict on week 2 (2026-12-02)
    await server.createBooking({
      roomId: 'room-alex',
      userId: 'user-sara',
      title: 'Week 2 Blocker',
      start: '2026-12-02T10:00:00+02:00',
      end: '2026-12-02T11:00:00+02:00',
      attendees: 2,
      needs: [],
    });

    const failRes = await store.createRecurringBooking(
      {
        roomId: 'room-alex',
        userId: 'user-osama',
        title: 'Weekly Pod',
        start: '2026-11-25T10:00:00+02:00',
        end: '2026-11-25T11:00:00+02:00',
        attendees: 2,
        needs: ['video'],
      },
      4,
    );
    expect(failRes.ok).toBe(false);
    expect(store.bookings().some((b) => b.title === 'Weekly Pod')).toBe(false);

    // Succeeds on room-karnak across all 4 weeks
    const okRes = await store.createRecurringBooking(
      {
        roomId: 'room-karnak',
        userId: 'user-osama',
        title: 'Weekly Karnak',
        start: '2026-11-25T14:00:00+02:00',
        end: '2026-11-25T15:00:00+02:00',
        attendees: 4,
        needs: ['projector'],
      },
      4,
    );
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.bookings).toHaveLength(4);
    }
  });
});

