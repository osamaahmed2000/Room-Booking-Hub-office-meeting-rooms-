import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { BookingDraft, BookingEvent, Room } from '../domain';
import { MockServer } from '../infrastructure/mock-server/mock-server';
import {
  mapBookingEventDto,
  mapBookingMutationDto,
  mapBookingsSnapshotDto,
  mapConflictErrorDto,
  mapRoomsDto,
} from './booking.dto';
import {
  BookingGateway,
  BookingMutationResult,
  BookingsSnapshot,
  GatewayOperation,
  GatewayResult,
  RecurringBookingMutationResult,
} from './booking.gateway';

function extractErrorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof (body as Record<string, unknown>)['message'] === 'string'
  ) {
    return (body as Record<string, unknown>)['message'] as string;
  }
  return fallback;
}

export class LocalMockGateway implements BookingGateway {
  readonly events$: Observable<BookingEvent>;
  private readonly seenEventIds = new Set<string>();

  constructor(private readonly server: MockServer) {
    this.events$ = this.server.events$.pipe(
      map((raw) => mapBookingEventDto(raw)),
      filter((evt): evt is BookingEvent => evt !== null),
      filter((evt) => {
        if (this.seenEventIds.has(evt.eventId)) return false;
        this.seenEventIds.add(evt.eventId);
        return true;
      }),
    );
  }

  async getRooms(): Promise<GatewayResult<Room[]>> {
    const res = await this.server.getRooms();
    if (res.status >= 500) {
      return this.serverError('getRooms', res.status, res.body);
    }
    if (res.status !== 200) {
      return this.malformedError('getRooms', res.status, 'Unexpected status for rooms.');
    }
    const mapped = mapRoomsDto(res.body);
    if (!mapped) {
      return this.malformedError('getRooms', res.status, 'Malformed rooms payload.');
    }
    return { ok: true, value: mapped };
  }

  async getBookings(date: string): Promise<GatewayResult<BookingsSnapshot>> {
    const res = await this.server.getBookings(date);
    if (res.status >= 500) {
      return this.serverError('getBookings', res.status, res.body);
    }
    if (res.status !== 200) {
      return this.malformedError('getBookings', res.status, 'Unexpected status for bookings.');
    }
    const mapped = mapBookingsSnapshotDto(res.body);
    if (!mapped) {
      return this.malformedError('getBookings', res.status, 'Malformed bookings snapshot payload.');
    }
    return { ok: true, value: mapped };
  }

  async createBooking(
    request: BookingDraft,
  ): Promise<GatewayResult<BookingMutationResult>> {
    const res = await this.server.createBooking({
      roomId: request.roomId,
      userId: request.userId,
      title: request.title,
      start: request.start,
      end: request.end,
      attendees: request.attendees,
      needs: [...request.needs],
    });

    if (res.status === 409) {
      const conflict = mapConflictErrorDto(res.body);
      if (!conflict) {
        return this.malformedError(
          'createBooking',
          409,
          'Malformed 409 conflict payload.',
        );
      }
      return {
        ok: false,
        error: {
          kind: 'conflict',
          status: 409,
          message: conflict.message,
          conflicts: conflict.conflicts,
          code: conflict.code,
        },
      };
    }

    if (res.status >= 500) {
      return this.serverError('createBooking', res.status, res.body);
    }

    if (res.status !== 201 && res.status !== 200) {
      return this.malformedError(
        'createBooking',
        res.status,
        'Unexpected status for createBooking.',
      );
    }

    const mapped = mapBookingMutationDto(res.body);
    if (!mapped) {
      return this.malformedError(
        'createBooking',
        res.status,
        'Malformed createBooking response payload.',
      );
    }
    return { ok: true, value: mapped };
  }

  async createRecurringBookings(
    requests: BookingDraft[],
  ): Promise<GatewayResult<RecurringBookingMutationResult>> {
    const res = await this.server.createRecurringBookings(
      requests.map((r) => ({
        roomId: r.roomId,
        userId: r.userId,
        title: r.title,
        start: r.start,
        end: r.end,
        attendees: r.attendees,
        needs: [...r.needs],
      })),
    );

    if (res.status === 409) {
      const conflict = mapConflictErrorDto(res.body);
      if (!conflict) {
        return this.malformedError('createBooking', 409, 'Malformed 409 conflict payload.');
      }
      return {
        ok: false,
        error: {
          kind: 'conflict',
          status: 409,
          message: conflict.message,
          conflicts: conflict.conflicts,
          code: conflict.code,
        },
      };
    }

    if (res.status >= 500) {
      return this.serverError('createBooking', res.status, res.body);
    }

    const mapped = mapBookingsSnapshotDto(res.body);
    if (!mapped) {
      return this.malformedError('createBooking', res.status, 'Malformed recurring response.');
    }
    return { ok: true, value: mapped };
  }

  async cancelBooking(
    bookingId: string,
  ): Promise<GatewayResult<BookingMutationResult>> {
    const res = await this.server.cancelBooking(bookingId);

    if (res.status === 404) {
      return {
        ok: false,
        error: {
          kind: 'not_found',
          status: 404,
          message: extractErrorMessage(res.body, `Booking ${bookingId} not found.`),
        },
      };
    }

    if (res.status >= 500) {
      return this.serverError('cancelBooking', res.status, res.body);
    }

    if (res.status !== 200) {
      return this.malformedError(
        'cancelBooking',
        res.status,
        'Unexpected status for cancelBooking.',
      );
    }

    const mapped = mapBookingMutationDto(res.body);
    if (!mapped) {
      return this.malformedError(
        'cancelBooking',
        res.status,
        'Malformed cancelBooking response payload.',
      );
    }
    return { ok: true, value: mapped };
  }

  private serverError(
    operation: GatewayOperation,
    status: number,
    body: unknown,
  ): GatewayResult<never> {
    return {
      ok: false,
      error: {
        kind: 'server_error',
        status: 500,
        message: extractErrorMessage(body, `Server error (${status}) during ${operation}.`),
        retryable: true,
        operation,
      },
    };
  }

  private malformedError(
    operation: GatewayOperation,
    status: number,
    message: string,
  ): GatewayResult<never> {
    return {
      ok: false,
      error: {
        kind: 'malformed_response',
        status,
        message,
        operation,
      },
    };
  }
}

