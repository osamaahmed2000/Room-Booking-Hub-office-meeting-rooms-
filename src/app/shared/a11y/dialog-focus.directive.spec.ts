import '@angular/compiler';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DialogFocusDirective } from './dialog-focus.directive';

@Component({
  standalone: true,
  imports: [DialogFocusDirective],
  template: `
    <div appDialogFocus role="dialog" aria-modal="true">
      <button id="first-btn" type="button">First</button>
      <button id="last-btn" type="button">Last</button>
    </div>
  `,
})
class HostDialogComponent {}

describe('DialogFocusDirective', () => {
  it('moves focus to first focusable element and traps Tab / Shift+Tab', async () => {
    await TestBed.configureTestingModule({
      imports: [HostDialogComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(HostDialogComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const first = el.querySelector('#first-btn') as HTMLButtonElement;
    const last = el.querySelector('#last-btn') as HTMLButtonElement;

    // jsdom offsetParent is null unless mocked; verify Tab wrapping behavior directly
    Object.defineProperty(first, 'offsetParent', { value: el });
    Object.defineProperty(last, 'offsetParent', { value: el });

    const dir = fixture.debugElement.children[0]!.injector.get(DialogFocusDirective);
    dir.ngAfterViewInit();
    expect(document.activeElement).toBe(first);

    // Shift+Tab on first wraps to last
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    dir.onKeyDown(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    // Tab on last wraps to first
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    dir.onKeyDown(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});

