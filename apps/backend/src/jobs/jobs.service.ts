import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';

/** pg-boss keeps its tables in a schema of its own, apart from the app's. */
const JOBS_SCHEMA = 'pgboss';

/** A run that takes longer than this is presumed stuck and given up. */
const RECURRING_JOB_EXPIRY_SECONDS = 5 * 60;

/** Completed runs are kept this long, for looking into a recent one. */
const COMPLETED_JOB_RETENTION_SECONDS = 24 * 60 * 60;

/**
 * Background work, on pg-boss: a job queue in PostgreSQL itself, so it adds no
 * service to run. A recurring job runs once per tick across every instance,
 * however many there are.
 *
 * pg-boss starts with the first job registered, not with the app: a server with
 * nothing to run in the background — push notifications off, say — never
 * installs its schema or opens its connections.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private boss: Promise<PgBoss> | undefined;

  constructor(private readonly config: ConfigService) {}

  /**
   * Runs `run` on a cron schedule, in UTC. A tick that comes due while the last
   * run is still going waits for it rather than running beside it, and one missed
   * while the server was down is skipped: the next tick does the same work.
   * A run that throws is logged and left to the next tick, never retried.
   */
  async every(name: string, cron: string, run: () => Promise<void>): Promise<void> {
    const boss = await this.start();

    await boss.createQueue(name, {
      policy: 'stately',
      retryLimit: 0,
      expireInSeconds: RECURRING_JOB_EXPIRY_SECONDS,
      deleteAfterSeconds: COMPLETED_JOB_RETENTION_SECONDS,
    });
    await boss.schedule(name, cron);
    await boss.work(name, async () => {
      try {
        await run();
      } catch (error) {
        this.logger.error(`Job ${name} failed`, error instanceof Error ? error.stack : error);
        throw error;
      }
    });
    this.logger.log(`Job ${name} scheduled: ${cron}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.boss === undefined) return;
    const boss = await this.boss.catch(() => undefined);
    await boss?.stop({ graceful: true, timeout: 10_000 });
  }

  private start(): Promise<PgBoss> {
    this.boss ??= (async () => {
      const boss = new PgBoss({
        connectionString: this.config.getOrThrow<string>('database.url'),
        schema: JOBS_SCHEMA,
        max: 2,
        application_name: 'pantry-pal-jobs',
      });
      // pg-boss reports trouble in its own loops here; unheard, an 'error' event would crash the process.
      boss.on('error', (error) => this.logger.error(error.message, error.stack));
      await boss.start();
      return boss;
    })();
    return this.boss;
  }
}
