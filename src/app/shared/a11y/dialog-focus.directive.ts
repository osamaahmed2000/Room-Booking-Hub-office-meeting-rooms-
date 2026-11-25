import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Traps Tab/Shift+Tab focus inside a dialog element and restores focus
 * to the previously active element when the dialog closes.
 */
@Directive({
  selector: '[appDialogFocus]',
  standalone: true,
  host: {
    '(keydown)': 'onKeyDown($event)',
  },
})
export class DialogFocusDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = this.getFocusableElements();
    if (focusables.length > 0) {
      focusables[0]!.focus();
    } else {
      this.el.nativeElement.setAttribute('tabindex', '-1');
      this.el.nativeElement.focus();
    }
  }

  ngOnDestroy(): void {
    if (this.previouslyFocused && this.previouslyFocused.isConnected) {
      this.previouslyFocused.focus();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;

    const focusables = this.getFocusableElements();
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !this.el.nativeElement.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !this.el.nativeElement.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  private getFocusableElements(): HTMLElement[] {
    return Array.from(
      this.el.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);
  }
}

