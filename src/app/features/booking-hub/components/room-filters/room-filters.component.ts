import { Component, computed, inject } from '@angular/core';
import { Equipment } from '../../../../domain';
import { BookingHubStore } from '../../../../state';

const EQUIPMENT_OPTIONS: readonly { value: Equipment; label: string }[] = [
  { value: 'projector', label: 'Projector' },
  { value: 'whiteboard', label: 'Whiteboard' },
  { value: 'video', label: 'Video Conf' },
];

@Component({
  selector: 'app-room-filters',
  standalone: true,
  templateUrl: './room-filters.component.html',
  styleUrl: './room-filters.component.scss',
})
export class RoomFiltersComponent {
  readonly store = inject(BookingHubStore);
  readonly equipmentOptions = EQUIPMENT_OPTIONS;

  readonly floors = computed(() => {
    const set = new Set(this.store.rooms().map((r) => r.floor));
    return Array.from(set).sort((a, b) => a - b);
  });

  readonly hasActiveFilters = computed(() => {
    const f = this.store.filters();
    return (
      f.floor !== null ||
      f.minCapacity !== null ||
      f.requiredEquipment.length > 0 ||
      f.searchQuery.trim().length > 0
    );
  });

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.setFilters({ searchQuery: value });
  }

  onFloorChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.store.setFilters({ floor: raw === '' ? null : Number(raw) });
  }

  onCapacityChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.store.setFilters({ minCapacity: raw === '' ? null : Number(raw) });
  }

  toggleEquipment(eq: Equipment): void {
    const current = this.store.filters().requiredEquipment;
    const next = current.includes(eq)
      ? current.filter((item) => item !== eq)
      : [...current, eq];
    this.store.setFilters({ requiredEquipment: next });
  }

  isEquipmentSelected(eq: Equipment): boolean {
    return this.store.filters().requiredEquipment.includes(eq);
  }

  clearFilters(): void {
    this.store.setFilters({
      floor: null,
      minCapacity: null,
      requiredEquipment: [],
      searchQuery: '',
    });
  }
}

