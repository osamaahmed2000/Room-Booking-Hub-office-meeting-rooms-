import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { BOOKING_GATEWAY, LocalMockGateway } from './data';
import {
  DEFAULT_OFFICE_POLICY,
  formatLocalSlotToIsoUtc,
  getZonedDateTimeParts,
} from './domain';
import { MockBookingRecord, MockServer } from './infrastructure/mock-server/mock-server';

function createBrowserMockServer(): MockServer {
  const todayCairo = getZonedDateTimeParts(
    Date.now(),
    DEFAULT_OFFICE_POLICY.timezone,
  ).date;

  const slotIso = (minuteOfDay: number): string => {
    const res = formatLocalSlotToIsoUtc(
      todayCairo,
      minuteOfDay,
      DEFAULT_OFFICE_POLICY.timezone,
    );
    return res.ok ? res.value : new Date().toISOString();
  };

  const seedBookings: MockBookingRecord[] = [
    {
      id: 'bk-seed-1',
      roomId: 'room-nile',
      userId: 'user-sara',
      title: 'Product Triage',
      start: slotIso(9 * 60),
      end: slotIso(10 * 60),
      attendees: 4,
      needs: ['projector'],
      status: 'confirmed',
    },
    {
      id: 'bk-seed-2',
      roomId: 'room-karnak',
      userId: 'user-osama',
      title: 'Architecture Review',
      start: slotIso(11 * 60),
      end: slotIso(12 * 60 + 30),
      attendees: 8,
      needs: ['projector', 'video'],
      status: 'confirmed',
    },
    {
      id: 'bk-seed-3',
      roomId: 'room-giza',
      userId: 'user-nadia',
      title: 'Quarterly Planning',
      start: slotIso(14 * 60),
      end: slotIso(15 * 60 + 30),
      attendees: 12,
      needs: ['projector', 'whiteboard', 'video'],
      status: 'confirmed',
    },
  ];

  return new MockServer({ bookings: seedBookings, latencyMs: 120 });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    {
      provide: BOOKING_GATEWAY,
      useFactory: () => new LocalMockGateway(createBrowserMockServer()),
    },
  ],
};

