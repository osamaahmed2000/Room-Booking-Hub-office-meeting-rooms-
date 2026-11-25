import { describe, expect, it } from 'vitest';
import { BookingEvent } from '../domain';
import { MockServer } from '../infrastructure/mock-server/mock-server';
import { LocalMockGateway } from './local-mock.gateway';

describe('LocalMockGateway', () => {
  it('gets rooms and bookings on 200 success and maps DTOs accurately', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);

    const roomsRes = await gateway.getRooms();
    expect(roomsRes.ok).toBe(true);
    if (roomsRes.ok) {
      expect(roomsRes.value.length).toBeGreaterThan(0);
      expect(roomsRes.value[0]).toEqual({
        id: 'room-nile',
        name: 'Nile Suite',
        floor: 1,
        capacity: 6,
        equipment: ['projector', 'whiteboard'],
      });
    }

    const bookingsRes = await gateway.getBookings('2026-11-25');
    expect(bookingsRes.ok).toBe(true);
    if (bookingsRes.ok) {
      expect(bookingsRes.value.bookings.length).toBe(2);
      expect(bookingsRes.value.seq).toBe(0);
    }
  });

  it('returns normalized server_error on GET 500 without swallowing', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);

    server.injectNextFault('GET_ROOMS', {
      kind: 'server_error',
      status: 500,
      message: 'DB timeout',
    });

    const res = await gateway.getRooms();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toEqual({
        kind: 'server_error',
        status: 500,
        message: 'DB timeout',
        retryable: true,
        operation: 'getRooms',
      });
    }
  });

  it('creates a booking on POST 201 and emits Booked event', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);
    const received: BookingEvent[] = [];
    const sub = gateway.events$.subscribe((e) => received.push(e));

    const res = await gateway.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Sprint Planning',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 4,
      needs: ['projector'],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.booking.status).toBe('confirmed');
      expect(res.value.booking.title).toBe('Sprint Planning');
      expect(res.value.seq).toBe(1);
    }

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('Booked');
    expect(received[0]?.seq).toBe(1);
    sub.unsubscribe();
  });

  it('returns typed conflict error on POST 409 preserving conflicting bookings', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);

    // Overlaps seeded bk-seed-1 (room-nile 09:00-10:00+02:00)
    const res = await gateway.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Overlapping Sync',
      start: '2026-11-25T09:30:00+02:00',
      end: '2026-11-25T10:30:00+02:00',
      attendees: 3,
      needs: [],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('conflict');
      if (res.error.kind === 'conflict') {
        expect(res.error.status).toBe(409);
        expect(res.error.conflicts).toHaveLength(1);
        expect(res.error.conflicts[0]?.id).toBe('bk-seed-1');
      }
    }
  });

  it('returns normalized server_error on POST 500', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);

    server.injectNextFault('POST_BOOKING', {
      kind: 'server_error',
      status: 500,
      message: 'Write failed',
    });

    const res = await gateway.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Test',
      start: '2026-11-25T15:00:00+02:00',
      end: '2026-11-25T16:00:00+02:00',
      attendees: 2,
      needs: [],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('server_error');
      if (res.error.kind === 'server_error') {
        expect(res.error.retryable).toBe(true);
        expect(res.error.operation).toBe('createBooking');
      }
    }
  });

  it('cancels a booking and emits Cancelled event, and handles 404/500', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);
    const received: BookingEvent[] = [];
    const sub = gateway.events$.subscribe((e) => received.push(e));

    const okRes = await gateway.cancelBooking('bk-seed-1');
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.value.booking.status).toBe('cancelled');
    }
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('Cancelled');

    const notFoundRes = await gateway.cancelBooking('bk-does-not-exist');
    expect(notFoundRes.ok).toBe(false);
    if (!notFoundRes.ok) {
      expect(notFoundRes.error.kind).toBe('not_found');
    }

    server.injectNextFault('DELETE_BOOKING', {
      kind: 'server_error',
      status: 500,
      message: 'Cancel failed',
    });
    const errRes = await gateway.cancelBooking('bk-seed-2');
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) {
      expect(errRes.error.kind).toBe('server_error');
    }

    sub.unsubscribe();
  });

  it('handles malformed 200 and malformed 409 payloads safely', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);

    server.injectNextFault('GET_ROOMS', {
      kind: 'malformed_body',
      status: 200,
      body: { invalid: true },
    });
    const badRooms = await gateway.getRooms();
    expect(badRooms.ok).toBe(false);
    if (!badRooms.ok) {
      expect(badRooms.error.kind).toBe('malformed_response');
    }

    server.injectNextFault('POST_BOOKING', {
      kind: 'malformed_body',
      status: 409,
      body: { message: 'broken', conflicts: 'not-an-array' },
    });
    const bad409 = await gateway.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Test',
      start: '2026-11-25T15:00:00+02:00',
      end: '2026-11-25T16:00:00+02:00',
      attendees: 2,
      needs: [],
    });
    expect(bad409.ok).toBe(false);
    if (!bad409.ok) {
      expect(bad409.error.kind).toBe('malformed_response');
      expect(bad409.error.status).toBe(409);
    }
  });

  it('deduplicates duplicate events by eventId on events$', () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);
    const received: BookingEvent[] = [];
    const sub = gateway.events$.subscribe((e) => received.push(e));

    const rawEvent = {
      type: 'Booked',
      eventId: 'evt-dup-1',
      seq: 1,
      booking: {
        id: 'bk-99',
        roomId: 'room-nile',
        userId: 'user-osama',
        title: 'Sync',
        start: '2026-11-25T15:00:00+02:00',
        end: '2026-11-25T16:00:00+02:00',
        attendees: 2,
        needs: [],
        status: 'confirmed',
      },
    };

    server.emitRawEvent(rawEvent);
    server.emitRawEvent(rawEvent);

    expect(received).toHaveLength(1);
    sub.unsubscribe();
  });

  it('rejects malformed booking timestamps from untrusted API payloads and invalid server intervals', async () => {
    const server = new MockServer();
    const gateway = new LocalMockGateway(server);

    server.injectNextFault('GET_BOOKINGS', {
      kind: 'malformed_body',
      status: 200,
      body: {
        seq: 1,
        bookings: [
          {
            id: 'bk-bad-date',
            roomId: 'room-nile',
            userId: 'user-osama',
            title: 'Bad Date',
            start: '2026-11-25', // date-only, not an ISO instant
            end: '2026-11-25T10:00:00+02:00',
            attendees: 2,
            needs: [],
            status: 'confirmed',
          },
        ],
      },
    });

    const badSnapshot = await gateway.getBookings('2026-11-25');
    expect(badSnapshot.ok).toBe(false);
    if (!badSnapshot.ok) {
      expect(badSnapshot.error.kind).toBe('malformed_response');
    }

    // Server rejects reversed/invalid interval directly at boundary
    const serverRes = await server.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Reversed',
      start: '2026-11-25T11:00:00+02:00',
      end: '2026-11-25T10:00:00+02:00',
      attendees: 2,
      needs: [],
    });
    expect(serverRes.status).toBe(400);
  });
});

