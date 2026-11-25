import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import {
  Booking,
  DEFAULT_OFFICE_POLICY,
  getZonedDateTimeParts,
  parseIsoInstant,
} from '../../../../domain';
import { APP_CLOCK, BookingHubStore } from '../../../../state';

@Component({
  selector: 'app-my-bookings',
  standalone: true,
  templateUrl: './my-bookings.component.html',
  styleUrl: './my-bookings.component.scss',
})
export class MyBookingsComponent {
  readonly store = inject(BookingHubStore);
  private readonly clock = inject(APP_CLOCK);

  @Output() readonly bookRoomRequested = new EventEmitter<void>();

  readonly confirmingId = signal<string | null>(null);

  getRoomName(roomId: string): string {
    return this.store.rooms().find((r) => r.id === roomId)?.name ?? roomId;
  }

  formatDate(iso: string): string {
    const parsed = parseIsoInstant(iso);
    if (!parsed.ok) return '';
    return getZonedDateTimeParts(parsed.value, DEFAULT_OFFICE_POLICY.timezone).date;
  }

  formatTimeRange(booking: Booking): string {
    const s = parseIsoInstant(booking.start);
    const e = parseIsoInstant(booking.end);
    if (!s.ok || !e.ok) return '';
    const sp = getZonedDateTimeParts(s.value, DEFAULT_OFFICE_POLICY.timezone);
    const ep = getZonedDateTimeParts(e.value, DEFAULT_OFFICE_POLICY.timezone);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(sp.hour)}:${pad(sp.minute)}–${pad(ep.hour)}:${pad(ep.minute)}`;
  }

  canCancel(booking: Booking): boolean {
    if (booking.status !== 'confirmed') return false;
    const end = parseIsoInstant(booking.end);
    return end.ok && end.value > this.clock.nowMs();
  }

  isCancelling(bookingId: string): boolean {
    return this.store.cancellingBookingIds().has(bookingId);
  }

  requestCancelConfirmation(bookingId: string): void {
    this.confirmingId.set(bookingId);
  }

  dismissConfirmation(): void {
    this.confirmingId.set(null);
  }

  confirmCancel(bookingId: string): void {
    this.store.requestCancelWithUndo(bookingId);
    this.confirmingId.set(null);
  }
}

