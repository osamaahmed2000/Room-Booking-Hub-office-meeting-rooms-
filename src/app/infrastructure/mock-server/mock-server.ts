import { Subject } from 'rxjs';

export interface MockHttpResponse<T = unknown> {
  status: number;
  body: T;
}

export interface MockRoomRecord {
  id: string;
  name: string;
  floor: number;
  capacity: number;
  equipment: ('projector' | 'whiteboard' | 'video')[];
}

export interface MockBookingRecord {
  id: string;
  roomId: string;
  userId: string;
  title: string;
  start: string;
  end: string;
  attendees: number;
  needs: ('projector' | 'whiteboard' | 'video')[];
  status: 'confirmed' | 'cancelled';
}

export interface MockBookingEventRecord {
  type: 'Booked' | 'Cancelled';
  eventId: string;
  seq: number;
  booking: MockBookingRecord;
}

export interface MockCreateBookingBody {
  roomId: string;
  userId: string;
  title: string;
  start: string;
  end: string;
  attendees: number;
  needs: ('projector' | 'whiteboard' | 'video')[];
}

export type MockFaultMode =
  | { kind: 'none' }
  | { kind: 'server_error'; status: 500; message: string }
  | { kind: 'malformed_body'; status: number; body: unknown }
  | { kind: 'conflict_409'; conflicts: MockBookingRecord[] };

const DEFAULT_SEED_ROOMS: MockRoomRecord[] = [
  {
    id: 'room-nile',
    name: 'Nile Suite',
    floor: 1,
    capacity: 6,
    equipment: ['projector', 'whiteboard'],
  },
  {
    id: 'room-karnak',
    name: 'Karnak Hall',
    floor: 2,
    capacity: 12,
    equipment: ['projector', 'whiteboard', 'video'],
  },
  {
    id: 'room-alex',
    name: 'Alexandria Pod',
    floor: 1,
    capacity: 4,
    equipment: ['video'],
  },
  {
    id: 'room-giza',
    name: 'Giza Boardroom',
    floor: 3,
    capacity: 16,
    equipment: ['projector', 'whiteboard', 'video'],
  },
];

const DEFAULT_SEED_BOOKINGS: MockBookingRecord[] = [
  {
    id: 'bk-seed-1',
    roomId: 'room-nile',
    userId: 'user-sara',
    title: 'Product Triage',
    start: '2026-11-25T09:00:00+02:00',
    end: '2026-11-25T10:00:00+02:00',
    attendees: 4,
    needs: ['projector'],
    status: 'confirmed',
  },
  {
    id: 'bk-seed-2',
    roomId: 'room-karnak',
    userId: 'user-osama',
    title: 'Architecture Review',
    start: '2026-11-25T11:00:00+02:00',
    end: '2026-11-25T12:30:00+02:00',
    attendees: 8,
    needs: ['projector', 'video'],
    status: 'confirmed',
  },
];

/**
 * Reconstructed deterministic in-memory mock server.
 * Isolated from domain logic and UI; simulates HTTP responses and global-seq events.
 */
export class MockServer {
  private readonly rooms: MockRoomRecord[];
  private bookings: MockBookingRecord[];
  private seq = 0;
  private idCounter = 100;
  private latencyMs: number;
  private nextFaults = new Map<'GET_ROOMS' | 'GET_BOOKINGS' | 'POST_BOOKING' | 'DELETE_BOOKING', MockFaultMode>();
  private readonly eventSubject = new Subject<unknown>();

  readonly events$ = this.eventSubject.asObservable();

  constructor(options?: {
    rooms?: MockRoomRecord[];
    bookings?: MockBookingRecord[];
    latencyMs?: number;
  }) {
    this.rooms = structuredClone(options?.rooms ?? DEFAULT_SEED_ROOMS);
    this.bookings = structuredClone(options?.bookings ?? DEFAULT_SEED_BOOKINGS);
    this.latencyMs = options?.latencyMs ?? 0;
  }

  injectNextFault(
    op: 'GET_ROOMS' | 'GET_BOOKINGS' | 'POST_BOOKING' | 'DELETE_BOOKING',
    fault: MockFaultMode,
  ): void {
    this.nextFaults.set(op, fault);
  }

  emitRawEvent(event: unknown): void {
    this.eventSubject.next(event);
  }

  async getRooms(): Promise<MockHttpResponse> {
    await this.delay();
    const fault = this.consumeFault('GET_ROOMS');
    if (fault) return this.faultToResponse(fault);

    return {
      status: 200,
      body: structuredClone(this.rooms),
    };
  }

  async getBookings(date?: string): Promise<MockHttpResponse> {
    await this.delay();
    const fault = this.consumeFault('GET_BOOKINGS');
    if (fault) return this.faultToResponse(fault);

    const filtered = date
      ? this.bookings.filter((b) => this.matchesCairoDate(b.start, date))
      : this.bookings;

    return {
      status: 200,
      body: {
        bookings: structuredClone(filtered),
        seq: this.seq,
      },
    };
  }

  async createBooking(body: MockCreateBookingBody): Promise<MockHttpResponse> {
    await this.delay();
    const fault = this.consumeFault('POST_BOOKING');
    if (fault) return this.faultToResponse(fault);

    const candStart = Date.parse(body.start);
    const candEnd = Date.parse(body.end);
    if (!Number.isFinite(candStart) || !Number.isFinite(candEnd) || candEnd <= candStart) {
      return {
        status: 400,
        body: { code: 'INVALID_INTERVAL', message: 'Invalid booking start/end interval.' },
      };
    }
    const bufferMs = 15 * 60_000;

    const conflicts = this.bookings.filter((b) => {
      if (b.status === 'cancelled' || b.roomId !== body.roomId) return false;
      const bStart = Date.parse(b.start);
      const bEnd = Date.parse(b.end);
      return candStart < bEnd + bufferMs && candEnd > bStart - bufferMs;
    });

    if (conflicts.length > 0) {
      return {
        status: 409,
        body: {
          code: 'BOOKING_CONFLICT',
          message: 'Room is already booked or within 15-minute buffer.',
          conflicts: structuredClone(conflicts),
        },
      };
    }

    this.idCounter += 1;
    const created: MockBookingRecord = {
      id: `bk-${this.idCounter}`,
      roomId: body.roomId,
      userId: body.userId,
      title: body.title,
      start: body.start,
      end: body.end,
      attendees: body.attendees,
      needs: [...body.needs],
      status: 'confirmed',
    };

    this.bookings = [...this.bookings, created];
    this.seq += 1;

    const event: MockBookingEventRecord = {
      type: 'Booked',
      eventId: `evt-${this.seq}`,
      seq: this.seq,
      booking: structuredClone(created),
    };
    this.eventSubject.next(event);

    return {
      status: 201,
      body: {
        booking: structuredClone(created),
        seq: this.seq,
      },
    };
  }

  async createRecurringBookings(
    bodies: MockCreateBookingBody[],
  ): Promise<MockHttpResponse> {
    await this.delay();
    const fault = this.consumeFault('POST_BOOKING');
    if (fault) return this.faultToResponse(fault);

    const bufferMs = 15 * 60_000;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      const candStart = Date.parse(body.start);
      const candEnd = Date.parse(body.end);
      if (!Number.isFinite(candStart) || !Number.isFinite(candEnd) || candEnd <= candStart) {
        return {
          status: 400,
          body: { code: 'INVALID_INTERVAL', message: `Week ${i + 1} has invalid interval.` },
        };
      }

      const conflicts = this.bookings.filter((b) => {
        if (b.status === 'cancelled' || b.roomId !== body.roomId) return false;
        const bStart = Date.parse(b.start);
        const bEnd = Date.parse(b.end);
        return candStart < bEnd + bufferMs && candEnd > bStart - bufferMs;
      });

      if (conflicts.length > 0) {
        return {
          status: 409,
          body: {
            code: 'BOOKING_CONFLICT',
            message: `Week ${i + 1} conflicts with an existing booking. No recurring bookings were created.`,
            conflicts: structuredClone(conflicts),
          },
        };
      }
    }

    const createdList: MockBookingRecord[] = [];
    for (const body of bodies) {
      this.idCounter += 1;
      const created: MockBookingRecord = {
        id: `bk-${this.idCounter}`,
        roomId: body.roomId,
        userId: body.userId,
        title: body.title,
        start: body.start,
        end: body.end,
        attendees: body.attendees,
        needs: [...body.needs],
        status: 'confirmed',
      };
      this.bookings = [...this.bookings, created];
      this.seq += 1;
      createdList.push(created);

      const event: MockBookingEventRecord = {
        type: 'Booked',
        eventId: `evt-${this.seq}`,
        seq: this.seq,
        booking: structuredClone(created),
      };
      this.eventSubject.next(event);
    }

    return {
      status: 201,
      body: {
        bookings: structuredClone(createdList),
        seq: this.seq,
      },
    };
  }

  async cancelBooking(bookingId: string): Promise<MockHttpResponse> {
    await this.delay();
    const fault = this.consumeFault('DELETE_BOOKING');
    if (fault) return this.faultToResponse(fault);

    const idx = this.bookings.findIndex((b) => b.id === bookingId);
    if (idx === -1) {
      return {
        status: 404,
        body: { code: 'NOT_FOUND', message: `Booking ${bookingId} not found.` },
      };
    }

    const existing = this.bookings[idx]!;
    const updated: MockBookingRecord = { ...existing, status: 'cancelled' };
    this.bookings = this.bookings.map((b, i) => (i === idx ? updated : b));
    this.seq += 1;

    const event: MockBookingEventRecord = {
      type: 'Cancelled',
      eventId: `evt-${this.seq}`,
      seq: this.seq,
      booking: structuredClone(updated),
    };
    this.eventSubject.next(event);

    return {
      status: 200,
      body: {
        booking: structuredClone(updated),
        seq: this.seq,
      },
    };
  }

  private matchesCairoDate(iso: string, targetDate: string): boolean {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return false;
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(new Date(ms)) === targetDate;
  }

  private consumeFault(
    op: 'GET_ROOMS' | 'GET_BOOKINGS' | 'POST_BOOKING' | 'DELETE_BOOKING',
  ): Exclude<MockFaultMode, { kind: 'none' }> | undefined {
    const fault = this.nextFaults.get(op);
    if (fault && fault.kind !== 'none') {
      this.nextFaults.delete(op);
      return fault;
    }
    return undefined;
  }

  private faultToResponse(fault: Exclude<MockFaultMode, { kind: 'none' }>): MockHttpResponse {
    switch (fault.kind) {
      case 'server_error':
        return { status: fault.status, body: { message: fault.message } };
      case 'malformed_body':
        return { status: fault.status, body: fault.body };
      case 'conflict_409':
        return {
          status: 409,
          body: {
            code: 'BOOKING_CONFLICT',
            message: 'Simulated 409 conflict.',
            conflicts: structuredClone(fault.conflicts),
          },
        };
    }
  }

  private delay(): Promise<void> {
    if (this.latencyMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }
}
