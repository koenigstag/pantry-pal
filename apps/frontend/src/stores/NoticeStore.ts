import { makeAutoObservable } from 'mobx';

export type NoticeTone = 'error' | 'info';

export interface Notice {
  readonly id: number;
  readonly tone: NoticeTone;
  readonly message: string;
}

const NOTICE_LIFETIME_MS = 6000;

/**
 * Transient messages ("couldn't save", "coming soon"), shown by `NoticeRegion`.
 *
 * A message already on screen is not shown twice, so a burst of identical
 * failures — every card of a dropped connection, say — reads as one notice.
 */
export class NoticeStore {
  notices: readonly Notice[] = [];

  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    makeAutoObservable<NoticeStore, 'nextId' | 'timers'>(
      this,
      { nextId: false, timers: false },
      { autoBind: true },
    );
  }

  error(message: string): void {
    this.show('error', message);
  }

  info(message: string): void {
    this.show('info', message);
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.notices = this.notices.filter((notice) => notice.id !== id);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private show(tone: NoticeTone, message: string): void {
    if (this.notices.some((notice) => notice.message === message)) return;

    const notice: Notice = { id: this.nextId++, tone, message };
    this.notices = [...this.notices, notice];
    this.timers.set(
      notice.id,
      setTimeout(() => this.dismiss(notice.id), NOTICE_LIFETIME_MS),
    );
  }
}
