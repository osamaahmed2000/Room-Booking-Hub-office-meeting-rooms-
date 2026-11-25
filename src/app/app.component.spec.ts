import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';
import { BOOKING_GATEWAY, LocalMockGateway } from './data';
import { BookingDrawerComponent } from './features/booking-hub/components/booking-drawer/booking-drawer.component';
import { MockServer } from './infrastructure/mock-server/mock-server';
import { APP_CLOCK, BookingHubStore } from './state';

const FIXED_NOW = Date.parse('2026-11-25T07:30:00+02:00');

describe('Room Booking Hub UI Components', () => {
  let server: MockServer;

  beforeEach(async () => {
    server = new MockServer();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BOOKING_GATEWAY, useFactory: () => new LocalMockGateway(server) },
        { provide: APP_CLOCK, useValue: { nowMs: () => FIXED_NOW } },
        BookingHubStore,
      ],
    }).compileComponents();
  });

  it('renders Meeting Room Schedule, rooms, and seeded bookings after init', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const store = TestBed.inject(BookingHubStore);
    fixture.detectChanges();
    await store.initialize();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Room Booking Hub');
    expect(el.textContent).toContain('Meeting Room Schedule');
    expect(el.textContent).toContain('Nile Suite');
    expect(el.textContent).toContain('Product Triage');
  });

  it('switches to My Bookings view and shows current user bookings', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const store = TestBed.inject(BookingHubStore);
    await store.initialize();
    fixture.detectChanges();

    const myBookingsNav = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button.nav-item'),
    ).find((b) => b.textContent?.includes('My Bookings')) as HTMLButtonElement;

    myBookingsNav.click();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Architecture Review');
    expect(el.textContent).not.toContain('Product Triage');
  });

  it('opens ConflictDialog when store has conflictDetails and requires alternative selection', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const store = TestBed.inject(BookingHubStore);
    await store.initialize();

    // Create a server-only booking that collides with our next createBooking call
    await server.createBooking({
      roomId: 'room-nile',
      userId: 'user-other',
      title: 'Raced Meeting',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 2,
      needs: [],
    });
    store.bookings.set(store.bookings().filter((b) => b.title !== 'Raced Meeting'));

    await store.createBooking({
      roomId: 'room-nile',
      userId: 'user-osama',
      title: 'Conflict Test',
      start: '2026-11-25T13:00:00+02:00',
      end: '2026-11-25T14:00:00+02:00',
      attendees: 3,
      needs: [],
    });

    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const dialog = el.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Time Slot Already Booked');

    const bookAltBtn = Array.from(dialog!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Book Selected Alternative'),
    ) as HTMLButtonElement;
    expect(bookAltBtn.disabled).toBe(true);
  });

  it('displays which week failed in BookingDrawer when weekly recurring booking conflicts', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const store = TestBed.inject(BookingHubStore);
    await store.initialize();

    // Put a conflict on Week 2 (2026-12-02) in store bookings
    store.bookings.update((prev) => [
      ...prev,
      {
        id: 'bk-w2-conflict',
        roomId: 'room-alex',
        userId: 'user-sara',
        title: 'Week 2 Blocker',
        start: '2026-12-02T10:00:00+02:00',
        end: '2026-12-02T11:00:00+02:00',
        attendees: 2,
        needs: [],
        status: 'confirmed',
      },
    ]);

    // Open BookingDrawer on room-alex
    fixture.componentInstance.openBookingDrawer('room-alex');
    fixture.detectChanges();

    const drawerDebug = fixture.debugElement.query(By.directive(BookingDrawerComponent));
    expect(drawerDebug).not.toBeNull();
    const drawerCmp = drawerDebug.componentInstance as BookingDrawerComponent;

    drawerCmp.title.set('Weekly Sync');
    drawerCmp.recurringWeeks.set(4);
    drawerCmp.startTime.set('10:00');
    drawerCmp.endTime.set('11:00');
    fixture.detectChanges();

    const drawerEl = drawerDebug.nativeElement as HTMLElement;
    expect(drawerEl.textContent).toContain('Recurring conflict');
    expect(drawerEl.textContent).toContain('Week 2 (2026-12-02)');
  });
});

