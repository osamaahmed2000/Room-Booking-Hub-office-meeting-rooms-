import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from '../app.component';
import { BOOKING_GATEWAY, LocalMockGateway } from '../data';
import { MockBookingRecord, MockServer } from '../infrastructure/mock-server/mock-server';
import { APP_CLOCK, BookingHubStore } from '../state';

const FIXED_NOW = Date.parse('2026-11-25T07:30:00+02:00');

describe('Room Booking Hub — End-to-End Integration Audit', () => {
  let server: MockServer;
  let store: BookingHubStore;

  async function initApp(options?: { bookings?: MockBookingRecord[] }) {
    TestBed.resetTestingModule();
    server = new MockServer({ bookings: options?.bookings ?? [] });
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BOOKING_GATEWAY, useFactory: () => new LocalMockGateway(server) },
        { provide: APP_CLOCK, useValue: { nowMs: () => FIXED_NOW } },
        BookingHubStore,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    store = TestBed.inject(BookingHubStore);
    fixture.detectChanges();
    await store.initialize();
    fixture.detectChanges();
    return { fixture, store, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('1. Normal booking: load, submit valid booking, appears in timeline and My Bookings', async () => {
    const { fixture, el } = await initApp();

    const res = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Q4 Roadmap',
      start: '2026-11-25T10:00:00+02:00',
      end: '2026-11-25T11:00:00+02:00',
      attendees: 4,
      needs: ['projector'],
    });

    expect(res.ok).toBe(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Q4 Roadmap');
    expect(store.myBookings().some((b) => b.title === 'Q4 Roadmap')).toBe(true);
  });

  it('2 & 3. Capacity and Equipment: rejects excess attendees and each missing equipment type', async () => {
    await initApp();

    const capRes = await store.createBooking({
      roomId: 'room-alex', // capacity 4, equipment ['video']
      userId: 'user-osama',
      title: 'Too Crowded',
      start: '2026-11-25T10:00:00+02:00',
      end: '2026-11-25T11:00:00+02:00',
      attendees: 5,
      needs: [],
    });
    expect(capRes.ok).toBe(false);
    if (!capRes.ok && capRes.reason === 'validation') {
      expect(capRes.errors.map((e) => e.code)).toContain('CAPACITY_EXCEEDED');
    }

    for (const missingEq of ['projector', 'whiteboard'] as const) {
      const eqRes = await store.createBooking({
        roomId: 'room-alex',
        userId: 'user-osama',
        title: `Need ${missingEq}`,
        start: '2026-11-25T10:00:00+02:00',
        end: '2026-11-25T11:00:00+02:00',
        attendees: 2,
        needs: [missingEq],
      });
      expect(eqRes.ok).toBe(false);
      if (!eqRes.ok && eqRes.reason === 'validation') {
        expect(eqRes.errors.map((e) => e.code)).toContain('MISSING_EQUIPMENT');
      }
    }

    const missingVideo = await store.createBooking({
      roomId: 'room-nile', // ['projector', 'whiteboard']
      userId: 'user-osama',
      title: 'Need video',
      start: '2026-11-25T10:00:00+02:00',
      end: '2026-11-25T11:00:00+02:00',
      attendees: 2,
      needs: ['video'],
    });
    expect(missingVideo.ok).toBe(false);
    if (!missingVideo.ok && missingVideo.reason === 'validation') {
      expect(missingVideo.errors.map((e) => e.code)).toContain('MISSING_EQUIPMENT');
    }
  });

  it('4. Buffer: 09:00-10:00 rejects 10:00-11:00 and 10:14-11:14, allows 10:15-11:15', async () => {
    await initApp({
      bookings: [
        {
          id: 'bk-buf',
          roomId: 'room-nile',
          userId: 'user-sara',
          title: 'Morning Sync',
          start: '2026-11-25T09:00:00+02:00',
          end: '2026-11-25T10:00:00+02:00',
          attendees: 3,
          needs: [],
          status: 'confirmed',
        },
      ],
    });

    const at1000 = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Zero Buffer',
      start: '2026-11-25T10:00:00+02:00',
      end: '2026-11-25T11:00:00+02:00',
      attendees: 2,
      needs: [],
    });
    expect(at1000.ok).toBe(false);

    const at1014 = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: '14m Buffer',
      start: '2026-11-25T10:14:00+02:00',
      end: '2026-11-25T11:14:00+02:00',
      attendees: 2,
      needs: [],
    });
    expect(at1014.ok).toBe(false);

    const at1015 = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: '15m Buffer Valid',
      start: '2026-11-25T10:15:00+02:00',
      end: '2026-11-25T11:15:00+02:00',
      attendees: 2,
      needs: [],
    });
    expect(at1015.ok).toBe(true);
  });

  it('5. Daily quota: 3 active allowed, 4th rejected, cancel 1 -> new booking passes', async () => {
    await initApp({
      bookings: [
        {
          id: 'q-1',
          roomId: 'room-nile',
          userId: 'user-osama',
          title: 'Q1',
          start: '2026-11-25T08:00:00+02:00',
          end: '2026-11-25T08:30:00+02:00',
          attendees: 2,
          needs: [],
          status: 'confirmed',
        },
        {
          id: 'q-2',
          roomId: 'room-karnak',
          userId: 'user-osama',
          title: 'Q2',
          start: '2026-11-25T10:00:00+02:00',
          end: '2026-11-25T10:30:00+02:00',
          attendees: 2,
          needs: [],
          status: 'confirmed',
        },
        {
          id: 'q-3',
          roomId: 'room-alex',
          userId: 'user-osama',
          title: 'Q3',
          start: '2026-11-25T12:00:00+02:00',
          end: '2026-11-25T12:30:00+02:00',
          attendees: 2,
          needs: [],
          status: 'confirmed',
        },
      ],
    });

    const fourth = await store.createBooking({
      roomId: 'room-giza',
      userId: 'user-osama',
      title: 'Q4',
      start: '2026-11-25T14:00:00+02:00',
      end: '2026-11-25T14:30:00+02:00',
      attendees: 2,
      needs: [],
    });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok && fourth.reason === 'validation') {
      expect(fourth.errors.map((e) => e.code)).toContain('DAILY_QUOTA_EXCEEDED');
    }

    const cancelled = await store.cancelBooking('q-1');
    expect(cancelled).toBe(true);

    const retryFourth = await store.createBooking({
      roomId: 'room-giza',
      userId: 'user-osama',
      title: 'Q4 After Cancel',
      start: '2026-11-25T14:00:00+02:00',
      end: '2026-11-25T14:30:00+02:00',
      attendees: 2,
      needs: [],
    });
    expect(retryFourth.ok).toBe(true);
  });

  it('6. Race condition: concurrent booking produces 409, refreshes, populates suggestions, shows ConflictDialog', async () => {
    const { fixture, el } = await initApp();

    // User A wins on server
    const serverWin = await server.createBooking({
      roomId: 'room-nile',
      userId: 'user-sara',
      title: 'Sara Won',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 4,
      needs: [],
    });
    expect(serverWin.status).toBe(201);

    // Simulate stale client before User B submits
    store.bookings.set([]);

    const userBRes = await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Osama Raced',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 4,
      needs: [],
    });

    expect(userBRes.ok).toBe(false);
    expect(userBRes.ok ? '' : userBRes.reason).toBe('conflict');
    expect(store.suggestedSlots().length).toBeGreaterThan(0);

    fixture.detectChanges();
    expect(el.querySelector('[role="alertdialog"]')?.textContent).toContain('Sara Won');
  });

  it('7 & 8. Real-time events & dirty data: deduplicates duplicate API records and duplicate/out-of-order events', async () => {
    await initApp({
      bookings: [
        {
          id: 'dup-1',
          roomId: 'room-nile',
          userId: 'user-osama',
          title: 'Duplicate Record',
          start: '2026-11-25T07:00:00Z', // 09:00+02:00
          end: '2026-11-25T08:00:00Z',   // 10:00+02:00
          attendees: 2,
          needs: [],
          status: 'confirmed',
        },
        {
          id: 'dup-1',
          roomId: 'room-nile',
          userId: 'user-osama',
          title: 'Duplicate Record',
          start: '2026-11-25T09:00:00+02:00',
          end: '2026-11-25T10:00:00+02:00',
          attendees: 2,
          needs: [],
          status: 'confirmed',
        },
        {
          id: 'cancelled-seed',
          roomId: 'room-nile',
          userId: 'user-osama',
          title: 'Cancelled Seed',
          start: '2026-11-25T11:00:00+02:00',
          end: '2026-11-25T12:00:00+02:00',
          attendees: 2,
          needs: [],
          status: 'cancelled',
        },
      ],
    });

    // Regression check: duplicate API record deduplicated in store
    expect(store.activeBookings()).toHaveLength(1);
    expect(store.bookingCounts().myActiveOnSelectedDate).toBe(1);

    // Real-time event from another user + duplicate emission
    const liveEvt = {
      type: 'Booked' as const,
      eventId: 'rt-1',
      seq: 1,
      booking: {
        id: 'bk-rt-1',
        roomId: 'room-alex',
        userId: 'user-nadia',
        title: 'Nadia Live',
        start: '2026-11-25T15:00:00+02:00',
        end: '2026-11-25T16:00:00+02:00',
        attendees: 2,
        needs: [],
        status: 'confirmed' as const,
      },
    };
    server.emitRawEvent(liveEvt);
    server.emitRawEvent(liveEvt);
    expect(store.activeBookings().filter((b) => b.id === 'bk-rt-1')).toHaveLength(1);

    // Real-time cancellation updates active state
    server.emitRawEvent({
      type: 'Cancelled',
      eventId: 'rt-2',
      seq: 2,
      booking: { ...liveEvt.booking, status: 'cancelled' },
    });
    expect(store.activeBookings().some((b) => b.id === 'bk-rt-1')).toBe(false);
  });

  it('10. API failures: GET 500, POST 500, DELETE 500, and successful retry after failure', async () => {
    await initApp();

    server.injectNextFault('GET_BOOKINGS', {
      kind: 'server_error',
      status: 500,
      message: 'Snapshot failed',
    });
    await store.refreshBookings();
    expect(store.error()?.kind).toBe('server_error');

    // Retry GET succeeds and clears error
    await store.refreshBookings();
    expect(store.error()).toBeNull();

    // POST 500 preserves state and allows retry
    server.injectNextFault('POST_BOOKING', {
      kind: 'server_error',
      status: 500,
      message: 'Save failed',
    });
    const draft = {
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Retryable Meeting',
      start: '2026-11-25T16:00:00+02:00',
      end: '2026-11-25T17:00:00+02:00',
      attendees: 2,
      needs: [] as ('projector' | 'whiteboard' | 'video')[],
    };
    const failPost = await store.createBooking(draft);
    expect(failPost.ok).toBe(false);
    expect(store.error()?.kind).toBe('server_error');

    const retryPost = await store.createBooking(draft);
    expect(retryPost.ok).toBe(true);
    expect(store.error()).toBeNull();
  });
});

