import { Global, Injectable, Module } from '@nestjs/common';
import { runOnCommit } from '@pantry-pal/db';
import { Subject, type Observable } from 'rxjs';

import type { DomainChange } from './domain-change';

/**
 * The one write path's exit: services publish here, `PantryGateway` holds the
 * single subscription and broadcasts. HTTP and socket writes therefore fan out
 * exactly once, and neither transport depends on the other.
 */
@Injectable()
export class ChangeFeed {
  private readonly subject = new Subject<DomainChange>();

  readonly changes$: Observable<DomainChange> = this.subject.asObservable();

  /**
   * Announces a change once the surrounding transaction commits, or at once if
   * there is none. A rolled-back write announces nothing, so no client ever
   * applies a change the database does not have.
   *
   * Publishing inside the transaction is therefore safe and expected. It also
   * satisfies `runOnCommit`'s must-not-throw rule: `Subject.next` does not
   * throw for a subscriber's error, which is why the gateway guards its own.
   */
  publish(change: DomainChange): void {
    runOnCommit(() => this.subject.next(change));
  }
}

/** Global, so every domain module can publish without importing the gateway's module. */
@Global()
@Module({
  providers: [ChangeFeed],
  exports: [ChangeFeed],
})
export class ChangeFeedModule {}
