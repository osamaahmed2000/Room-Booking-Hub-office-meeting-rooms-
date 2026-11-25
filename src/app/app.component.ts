import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import {
  Booking,
  DEFAULT_OFFICE_POLICY,
  getZonedDateTimeParts,
  parseIsoInstant,
} from './domain';
import { BookingDrawerComponent } from './features/booking-hub/components/booking-drawer/booking-drawer.component';
import { ConflictDialogComponent } from './features/booking-hub/components/conflict-dialog/conflict-dialog.component';
import { DayTimelineComponent } from './features/booking-hub/components/day-timeline/day-timeline.component';
import { MyBookingsComponent } from './features/booking-hub/components/my-bookings/my-bookings.component';
import { RoomsDirectoryComponent } from './features/booking-hub/components/rooms-directory/rooms-directory.component';
import { DialogFocusDirective } from './shared/a11y/dialog-focus.directive';
import { BookingHubStore } from './state';

export type NavSection = 'timeline' | 'my-bookings' | 'rooms';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    DayTimelineComponent,
    MyBookingsComponent,
    RoomsDirectoryComponent,
    BookingDrawerComponent,
    ConflictDialogComponent,
    DialogFocusDirective,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  readonly store = inject(BookingHubStore);

  readonly activeSection = signal<NavSection>('timeline');
  readonly drawerOpen = signal(false);
  readonly drawerRoomId = signal<string | null>(null);
  readonly statusMessage = signal<string | null>(null);

  ngOnInit(): void {
    void this.store.initialize();
  }

  setSection(section: NavSection): void {
    this.activeSection.set(section);
  }

  openBookingDrawer(roomId?: string): void {
    this.drawerRoomId.set(roomId ?? null);
    this.drawerOpen.set(true);
  }

  closeBookingDrawer(): void {
    this.drawerOpen.set(false);
    this.drawerRoomId.set(null);
  }

  inspectBooking(booking: Booking): void {
    this.store.selectBooking(booking);
  }

  closeBookingDetail(): void {
    this.store.selectBooking(null);
  }

  @HostListener('document:keydown.escape')
  onEscapeDetail(): void {
    if (this.store.selectedBooking()) {
      this.closeBookingDetail();
    }
  }

  getRoomName(roomId: string): string {
    return this.store.rooms().find((r) => r.id === roomId)?.name ?? roomId;
  }

  formatBookingWindow(booking: Booking): string {
    const s = parseIsoInstant(booking.start);
    const e = parseIsoInstant(booking.end);
    if (!s.ok || !e.ok) return '';
    const sp = getZonedDateTimeParts(s.value, DEFAULT_OFFICE_POLICY.timezone);
    const ep = getZonedDateTimeParts(e.value, DEFAULT_OFFICE_POLICY.timezone);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${sp.date} · ${pad(sp.hour)}:${pad(sp.minute)}–${pad(ep.hour)}:${pad(ep.minute)} Cairo`;
  }

  async cancelInspectedBooking(bookingId: string): Promise<void> {
    const ok = await this.store.cancelBooking(bookingId);
    if (ok) {
      this.store.selectBooking(null);
      this.showSuccess('Booking cancelled.');
    }
  }

  showSuccess(message: string): void {
    this.statusMessage.set(message);
  }

  dismissStatus(): void {
    this.statusMessage.set(null);
  }
}

