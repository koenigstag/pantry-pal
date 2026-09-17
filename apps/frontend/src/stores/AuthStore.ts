import type { AuthSession } from '@pantry-pal/shared';
import type { DevSignInDto, SignInDto, SignUpDto } from '@pantry-pal/shared/dto';
import { makeAutoObservable } from 'mobx';

import { messages } from '../i18n/messages';
import { ApiError, type AuthApi } from '../services/api';
import {
  endSession,
  readSession,
  saveSession,
  subscribeSession,
  type StoredSession,
} from '../services/session';

/** What each route that signs in answers when it refuses, beyond the statuses every one shares. */
type RefusalMessages = Readonly<Partial<Record<number, string>>>;

function refusalMessage(error: unknown, refusals: RefusalMessages): string {
  if (!(error instanceof ApiError)) return messages.auth.offline;
  if (error.status === 429) return messages.auth.tooManyAttempts;
  return refusals[error.status] ?? messages.auth.failed;
}

/**
 * Whether this browser is signed in. Every tab shares one session
 * (`services/session.ts`), so signing in or out in one tab does so in all.
 *
 * Signing in only stores the session: the pantry loads once the signed-in pages
 * mount (`SessionStoreProvider`), and a stored session is trusted until a request
 * proves it over.
 */
export class AuthStore {
  private readonly api: AuthApi;

  isSignedIn: boolean;
  /** The session ended without this tab signing out: it expired, or another tab signed out. */
  endedElsewhere = false;

  private signingOut = false;

  constructor(api: AuthApi) {
    this.api = api;
    this.isSignedIn = readSession() !== null;

    makeAutoObservable<AuthStore, 'api' | 'signingOut'>(
      this,
      { api: false, signingOut: false },
      { autoBind: true },
    );
  }

  /** Follows the session, in this tab and the others. Returns the function that stops. */
  start(): () => void {
    this.applySession(readSession());
    return subscribeSession(this.applySession);
  }

  /** `null` once signed in, else the message to show. */
  signIn(dto: SignInDto): Promise<string | null> {
    return this.begin(() => this.api.signIn(dto), { 401: messages.auth.invalidCredentials });
  }

  signUp(dto: SignUpDto): Promise<string | null> {
    return this.begin(() => this.api.signUp(dto), { 409: messages.auth.emailTaken });
  }

  devSignIn(dto: DevSignInDto): Promise<string | null> {
    return this.begin(() => this.api.devSignIn(dto), { 404: messages.auth.dev.unavailable });
  }

  async signOut(): Promise<void> {
    this.signingOut = true;
    try {
      await endSession();
    } finally {
      this.signingOut = false;
    }
  }

  private async begin(
    call: () => Promise<AuthSession>,
    refusals: RefusalMessages,
  ): Promise<string | null> {
    try {
      saveSession(await call());
      return null;
    } catch (error) {
      return refusalMessage(error, refusals);
    }
  }

  private applySession(session: StoredSession | null): void {
    const signedIn = session !== null;
    if (this.isSignedIn && !signedIn) this.endedElsewhere = !this.signingOut;
    if (signedIn) this.endedElsewhere = false;
    this.isSignedIn = signedIn;
  }
}
