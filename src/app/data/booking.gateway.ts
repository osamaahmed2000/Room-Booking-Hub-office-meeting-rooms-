import { Observable } from 'rxjs';
import { Booking, BookingDraft, BookingEvent, Room } from '../domain';

export type GatewayOperation =
  | 'getRooms'
  | 'getBookings'
  | 'createBooking'
  | 'cancelBooking';

export type GatewayError =
  | {
      kind: 'conflict';
      status: 409;
      message: string;
      conflicts: Booking[];
      code?: string;
    }
  | {
      kind: 'server_error';
      status: 500;
      message: string;
      retryable: true;
      operation: GatewayOperation;
    }
  | {
      kind: 'not_found';
      status: 404;
      message: string;
    }
  | {
      kind: 'malformed_response';
      status: number;
      message: string;
      operation: GatewayOperation;
    };

export type GatewayResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GatewayError };

export interface BookingsSnapshot {
  bookings: Booking[];
  seq: number;
}

export interface BookingMutationResult {
  booking: Booking;
  seq: number;
}

export interface RecurringBookingMutationResult {
  bookings: Booking[];
  seq: number;
}

export interface BookingGateway {
  readonly events$: Observable<BookingEvent>;
  getRooms(): Promise<GatewayResult<Room[]>>;
  getBookings(date: string): Promise<GatewayResult<BookingsSnapshot>>;
  createBooking(request: BookingDraft): Promise<GatewayResult<BookingMutationResult>>;
  createRecurringBookings?(
    requests: BookingDraft[],
  ): Promise<GatewayResult<RecurringBookingMutationResult>>;
  cancelBooking(bookingId: string): Promise<GatewayResult<BookingMutationResult>>;
}

