import { Booking, BookingEvent, Equipment, Room, parseIsoInstant } from '../domain';

export interface RoomDto {
  id: string;
  name: string;
  floor: number;
  capacity: number;
  equipment: Equipment[];
}

export interface BookingDto {
  id: string;
  roomId: string;
  userId: string;
  title: string;
  start: string;
  end: string;
  attendees: number;
  needs: Equipment[];
  status: 'confirmed' | 'cancelled';
}

export interface BookingsSnapshotDto {
  bookings: BookingDto[];
  seq: number;
}

export interface BookingMutationDto {
  booking: BookingDto;
  seq: number;
}

export interface BookingEventDto {
  type: 'Booked' | 'Cancelled';
  eventId: string;
  seq: number;
  booking: BookingDto;
}

export interface ConflictErrorDto {
  code?: string;
  message: string;
  conflicts: BookingDto[];
}

const VALID_EQUIPMENT = new Set<string>(['projector', 'whiteboard', 'video']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEquipmentArray(value: unknown): value is Equipment[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && VALID_EQUIPMENT.has(item))
  );
}

export function mapRoomDto(raw: unknown): Room | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw['id'] !== 'string' ||
    typeof raw['name'] !== 'string' ||
    typeof raw['floor'] !== 'number' ||
    !Number.isFinite(raw['floor']) ||
    typeof raw['capacity'] !== 'number' ||
    !Number.isInteger(raw['capacity']) ||
    raw['capacity'] < 1 ||
    !isEquipmentArray(raw['equipment'])
  ) {
    return null;
  }

  return {
    id: raw['id'],
    name: raw['name'],
    floor: raw['floor'],
    capacity: raw['capacity'],
    equipment: [...raw['equipment']],
  };
}

export function mapRoomsDto(raw: unknown): Room[] | null {
  if (!Array.isArray(raw)) return null;
  const rooms: Room[] = [];
  for (const item of raw) {
    const mapped = mapRoomDto(item);
    if (!mapped) return null;
    rooms.push(mapped);
  }
  return rooms;
}

export function mapBookingDto(raw: unknown): Booking | null {
  if (!isRecord(raw)) return null;
  const status = raw['status'];
  if (
    typeof raw['id'] !== 'string' ||
    typeof raw['roomId'] !== 'string' ||
    typeof raw['userId'] !== 'string' ||
    typeof raw['title'] !== 'string' ||
    typeof raw['start'] !== 'string' ||
    typeof raw['end'] !== 'string' ||
    !parseIsoInstant(raw['start']).ok ||
    !parseIsoInstant(raw['end']).ok ||
    typeof raw['attendees'] !== 'number' ||
    !Number.isInteger(raw['attendees']) ||
    raw['attendees'] < 1 ||
    !isEquipmentArray(raw['needs']) ||
    (status !== 'confirmed' && status !== 'cancelled')
  ) {
    return null;
  }

  return {
    id: raw['id'],
    roomId: raw['roomId'],
    userId: raw['userId'],
    title: raw['title'],
    start: raw['start'],
    end: raw['end'],
    attendees: raw['attendees'],
    needs: [...raw['needs']],
    status,
  };
}

export function mapBookingsSnapshotDto(
  raw: unknown,
): { bookings: Booking[]; seq: number } | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw['bookings']) || typeof raw['seq'] !== 'number') {
    return null;
  }
  const bookings: Booking[] = [];
  for (const item of raw['bookings']) {
    const mapped = mapBookingDto(item);
    if (!mapped) return null;
    bookings.push(mapped);
  }
  return { bookings, seq: raw['seq'] };
}

export function mapBookingMutationDto(
  raw: unknown,
): { booking: Booking; seq: number } | null {
  if (!isRecord(raw)) return null;
  const booking = mapBookingDto(raw['booking']);
  if (!booking || typeof raw['seq'] !== 'number') return null;
  return { booking, seq: raw['seq'] };
}

export function mapBookingEventDto(raw: unknown): BookingEvent | null {
  if (!isRecord(raw)) return null;
  const type = raw['type'];
  if (
    (type !== 'Booked' && type !== 'Cancelled') ||
    typeof raw['eventId'] !== 'string' ||
    typeof raw['seq'] !== 'number'
  ) {
    return null;
  }
  const booking = mapBookingDto(raw['booking']);
  if (!booking) return null;

  return {
    type,
    eventId: raw['eventId'],
    seq: raw['seq'],
    booking,
  };
}

export function mapConflictErrorDto(
  raw: unknown,
): { message: string; conflicts: Booking[]; code?: string } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['message'] !== 'string' || !Array.isArray(raw['conflicts'])) {
    return null;
  }
  const conflicts: Booking[] = [];
  for (const item of raw['conflicts']) {
    const mapped = mapBookingDto(item);
    if (!mapped) return null;
    conflicts.push(mapped);
  }
  return {
    message: raw['message'],
    conflicts,
    code: typeof raw['code'] === 'string' ? raw['code'] : undefined,
  };
}

