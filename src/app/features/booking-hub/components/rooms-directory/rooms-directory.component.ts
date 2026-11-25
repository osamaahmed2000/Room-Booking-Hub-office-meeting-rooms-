import { Component, EventEmitter, Output, inject } from '@angular/core';
import { BookingHubStore } from '../../../../state';
import { RoomFiltersComponent } from '../room-filters/room-filters.component';

@Component({
  selector: 'app-rooms-directory',
  standalone: true,
  imports: [RoomFiltersComponent],
  templateUrl: './rooms-directory.component.html',
  styleUrl: './rooms-directory.component.scss',
})
export class RoomsDirectoryComponent {
  readonly store = inject(BookingHubStore);
  @Output() readonly bookRoomRequested = new EventEmitter<{ roomId: string }>();
}

