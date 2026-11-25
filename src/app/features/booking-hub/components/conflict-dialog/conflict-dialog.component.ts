import {
  Component,
  EventEmitter,
  HostListener,
  Output,
  inject,
  signal,
} from '@angular/core';
import {
  DEFAULT_OFFICE_POLICY,
  SlotSuggestion,
  getZonedDateTimeParts,
  parseIsoInstant,
} from '../../../../domain';
import { DialogFocusDirective } from '../../../../shared/a11y/dialog-focus.directive';
import { BookingHubStore } from '../../../../state';

@Component({
  selector: 'app-conflict-dialog',
  standalone: true,
  imports: [DialogFocusDirective],templateUrl: './conflict-dialog.component.html',
  styleUrl: './conflict-dialog.component.scss',
})
export class ConflictDialogComponent {
  readonly store = inject(BookingHubStore);
  @Output() readonly bookedAlternative = new EventEmitter<string>();

  readonly selectedSuggestion = signal<SlotSuggestion | null>(null);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.store.conflictDetails() && !this.store.submitting()) {
      this.close();
    }
  }

  getRoomName(roomId: string): string {
    return this.store.rooms().find((r) => r.id === roomId)?.name ?? roomId;
  }

  formatCairoRange(startInput: Date | string, endInput: Date | string): string {
    const s = startInput instanceof Date ? { ok: true as const, value: startInput.getTime() } : parseIsoInstant(startInput);
    const e = endInput instanceof Date ? { ok: true as const, value: endInput.getTime() } : parseIsoInstant(endInput);
    if (!s.ok || !e.ok) return '';
    const sp = getZonedDateTimeParts(s.value, DEFAULT_OFFICE_POLICY.timezone);
    const ep = getZonedDateTimeParts(e.value, DEFAULT_OFFICE_POLICY.timezone);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${sp.date} · ${pad(sp.hour)}:${pad(sp.minute)}–${pad(ep.hour)}:${pad(ep.minute)} Cairo`;
  }

  selectSuggestion(suggestion: SlotSuggestion): void {
    this.selectedSuggestion.set(suggestion);
  }

  isSelected(suggestion: SlotSuggestion): boolean {
    const cur = this.selectedSuggestion();
    return (
      cur !== null &&
      cur.roomId === suggestion.roomId &&
      cur.start.getTime() === suggestion.start.getTime() &&
      cur.end.getTime() === suggestion.end.getTime()
    );
  }

  close(): void {
    this.selectedSuggestion.set(null);
    this.store.clearConflict();
  }

  async bookSelectedAlternative(): Promise<void> {
    const details = this.store.conflictDetails();
    const chosen = this.selectedSuggestion();
    if (!details || !chosen) return;

    const outcome = await this.store.createBooking({
      ...details.draft,
      roomId: chosen.roomId,
      start: chosen.start.toISOString(),
      end: chosen.end.toISOString(),
    });

    if (outcome.ok) {
      this.selectedSuggestion.set(null);
      this.store.clearConflict();
      this.bookedAlternative.emit(
        `Booked "${outcome.booking.title}" in ${this.getRoomName(outcome.booking.roomId)}.`,
      );
    }
  }
}

