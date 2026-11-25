export type Equipment = 'projector' | 'whiteboard' | 'video';

export interface Room {
  id: string;
  name: string;
  floor: number;
  capacity: number;
  equipment: Equipment[];
}

export interface Booking {
  id: string;
  roomId: string;
  userId: string;
  title: string;
  start: string;
  end: string;
  attendees: number;
  needs: Room['equipment'];
  status: 'confirmed' | 'cancelled';
}

export type BookingEvent = {
  type: 'Booked' | 'Cancelled';
  eventId: string;
  seq: number;
  booking: Booking;
};

export type BookingDraft = Omit<Booking, 'id' | 'status'>;

export interface BookingRequest {
  roomId: string;
  userId: string;
  title: string;
  start: Date | string;
  end: Date | string;
  attendees: number;
  needs: Room['equipment'];
  editingBookingId?: string;
}

export interface WorkingHoursWindow {
  startMinute: number;
  endMinute: number;
}

export interface OfficePolicy {
  timezone: string;
  /** Working hours per weekday (0 = Sun .. 6 = Sat). Missing weekday = non-working day. */
  dayHours: Readonly<Record<number, WorkingHoursWindow>>;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  bufferMinutes: number;
  maxActiveBookingsPerDay: number;
  maxRecurringWeeks: number;
  slotStepMinutes: number;
}

export const DEFAULT_OFFICE_POLICY: OfficePolicy = {
  timezone: 'Africa/Cairo',
  dayHours: {
    0: { startMinute: 8 * 60, endMinute: 18 * 60 }, // Sun 08:00-18:00
    1: { startMinute: 8 * 60, endMinute: 18 * 60 }, // Mon 08:00-18:00
    2: { startMinute: 8 * 60, endMinute: 18 * 60 }, // Tue 08:00-18:00
    3: { startMinute: 8 * 60, endMinute: 18 * 60 }, // Wed 08:00-18:00
    4: { startMinute: 8 * 60, endMinute: 18 * 60 }, // Thu 08:00-18:00
    5: { startMinute: 8 * 60, endMinute: 13 * 60 }, // Fri half-day 08:00-13:00 (Day-2)
  },
  minDurationMinutes: 15,
  maxDurationMinutes: 120,
  bufferMinutes: 15,
  maxActiveBookingsPerDay: 3,
  maxRecurringWeeks: 4,
  slotStepMinutes: 15,
};

export type DomainErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_TITLE'
  | 'INVALID_ATTENDEES'
  | 'INVALID_TIMESTAMP'
  | 'NONEXISTENT_LOCAL_TIME'
  | 'AMBIGUOUS_LOCAL_TIME'
  | 'INVALID_INTERVAL'
  | 'DURATION_TOO_SHORT'
  | 'DURATION_TOO_LONG'
  | 'NON_WORKING_DAY'
  | 'CROSSES_MIDNIGHT'
  | 'OUTSIDE_WORKING_HOURS'
  | 'BOOKING_IN_PAST'
  | 'ROOM_NOT_FOUND'
  | 'CAPACITY_EXCEEDED'
  | 'MISSING_EQUIPMENT'
  | 'DAILY_QUOTA_EXCEEDED'
  | 'ROOM_CONFLICT'
  | 'INVALID_RECURRENCE_WEEKS';

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  field?: 'roomId' | 'userId' | 'title' | 'start' | 'end' | 'attendees' | 'needs' | 'weeks';
  meta?: Record<string, string | number | readonly string[]>;
}

export type Result<T, E = DomainError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface ValidationResult {
  ok: boolean;
  errors: DomainError[];
}

export interface SlotSuggestion {
  roomId: string;
  start: Date;
  end: Date;
  reason: string;
  distanceMinutes: number;
}

export interface RecurringWeekResult {
  weekIndex: number;
  date: string;
  start: Date;
  end: Date;
  ok: boolean;
  errors: DomainError[];
}

export interface RecurringValidationResult {
  ok: boolean;
  occurrences: RecurringWeekResult[];
  failedWeeks: RecurringWeekResult[];
}
