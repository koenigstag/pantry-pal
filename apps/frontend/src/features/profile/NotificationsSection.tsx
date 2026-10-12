import {
  EXPIRY_NOTIFICATION_HOUR,
  PUSH_TOPICS,
  type PushDevice,
  type PushTopic,
} from '@pantry-pal/shared';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { formatHour } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import {
  currentSubscription,
  notificationPermission,
  pushSupport,
  PushPermissionError,
  subscribe,
  unsubscribe,
} from '../../services/push';
import { usePantryStore } from '../../stores/StoreContext';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../auth/AuthPage';

type State =
  | { kind: 'loading' }
  /** The server has no push: the card is not shown at all. */
  | { kind: 'off' }
  | { kind: 'load-failed' }
  | { kind: 'unsupported' }
  | { kind: 'needs-install' }
  | {
      kind: 'ready';
      publicKey: string;
      /** This browser as the server has it, or `null` when it is not registered. */
      device: PushDevice | null;
      permission: NotificationPermission;
    };

type Busy = 'on' | 'off' | 'test' | 'topics' | null;

/** The order the switches are shown in, whatever order a device saved them in. */
function inOrder(topics: readonly PushTopic[]): PushTopic[] {
  return PUSH_TOPICS.filter((topic) => topics.includes(topic));
}

/** What a switch is about. The expiry one names the hour, in the page's language. */
function topicHint(topic: PushTopic): string {
  const { topics } = messages.notifications;
  switch (topic) {
    case 'expiry':
      return topics.expiry.hint(formatHour(EXPIRY_NOTIFICATION_HOUR));
    default:
      return topics[topic].hint;
  }
}

/**
 * Profile's notifications: turning them on for this browser, what it is told
 * about, a test, and turning them off. Each switch belongs to this device only.
 * Hidden while the server has push turned off; online only, like the rest of
 * the account's settings.
 */
export const NotificationsSection = observer(function NotificationsSection(): ReactElement | null {
  const pantry = usePantryStore();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const t = messages.notifications;

  const load = useCallback(async (): Promise<void> => {
    const status = await pantry.pushStatus();
    if (!status.ok) return setState({ kind: 'load-failed' });
    if (status.value.publicKey === null) return setState({ kind: 'off' });

    const support = await pushSupport();
    if (support !== 'supported') return setState({ kind: support });

    const [devices, subscription] = await Promise.all([
      pantry.pushDevices(),
      currentSubscription(),
    ]);
    if (!devices.ok) return setState({ kind: 'load-failed' });
    setState({
      kind: 'ready',
      publicKey: status.value.publicKey,
      device:
        subscription === null
          ? null
          : (devices.value.find((device) => device.endpoint === subscription.endpoint) ?? null),
      permission: notificationPermission(),
    });
  }, [pantry]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading' || state.kind === 'off') return null;

  /** Registers this browser's subscription with `topics`: turning on, or a switch changed. */
  async function save(subscription: PushSubscriptionJSON, topics: PushTopic[]): Promise<boolean> {
    const { endpoint, keys } = subscription;
    if (endpoint === undefined || keys?.['p256dh'] === undefined || keys['auth'] === undefined) {
      setError(t.turnOnFailed);
      return false;
    }
    const result = await pantry.registerPushDevice({
      endpoint,
      keys: { p256dh: keys['p256dh'], auth: keys['auth'] },
      topics,
    });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, device: result.value, permission: 'granted' }
        : current,
    );
    return true;
  }

  async function turnOn(publicKey: string): Promise<void> {
    setBusy('on');
    setError(null);
    try {
      await save(await subscribe(publicKey), [...PUSH_TOPICS]);
    } catch (failure) {
      if (failure instanceof PushPermissionError) {
        if (failure.permission === 'denied') {
          setState((current) =>
            current.kind === 'ready' ? { ...current, permission: 'denied' } : current,
          );
        } else setError(t.notAllowed);
      } else setError(t.turnOnFailed);
    } finally {
      setBusy(null);
    }
  }

  async function setTopic(device: PushDevice, topic: PushTopic, on: boolean): Promise<void> {
    const topics = inOrder(
      on ? [...device.topics, topic] : device.topics.filter((other) => other !== topic),
    );
    setBusy('topics');
    setError(null);
    // Shown at once; put back if the server does not take it.
    setState((current) =>
      current.kind === 'ready' ? { ...current, device: { ...device, topics } } : current,
    );
    const subscription = await currentSubscription();
    const saved = subscription !== null && (await save(subscription.toJSON(), topics));
    if (!saved) {
      if (subscription === null) setError(t.saveFailed);
      setState((current) => (current.kind === 'ready' ? { ...current, device } : current));
    }
    setBusy(null);
  }

  async function sendTest(): Promise<void> {
    setBusy('test');
    setTestNote(null);
    setError(null);
    const result = await pantry.testPush();
    setTestNote(result.ok && result.value.sent > 0 ? t.testSent : t.testFailed);
    setBusy(null);
  }

  async function turnOff(device: PushDevice): Promise<void> {
    setBusy('off');
    setError(null);
    setTestNote(null);
    const failure = await pantry.removePushDevice(device.id);
    if (failure !== null) {
      setError(failure);
    } else {
      try {
        // The push service forgets this browser too; turning on again makes a new one.
        await unsubscribe();
      } catch {
        // The server no longer sends to it, which is what matters.
      }
      setState((current) => (current.kind === 'ready' ? { ...current, device: null } : current));
    }
    setBusy(null);
  }

  const ready = state.kind === 'ready' ? state : null;
  const blocked = ready?.permission === 'denied';
  const device = ready?.device ?? null;

  return (
    <section className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <h2 className="font-semibold">{t.title}</h2>
      <p className="text-sm text-ink-muted">{t.intro}</p>

      {state.kind === 'load-failed' && <p className="text-sm text-ink-muted">{t.loadFailed}</p>}
      {state.kind === 'unsupported' && <p className="text-sm text-ink-muted">{t.unsupported}</p>}
      {state.kind === 'needs-install' && <p className="text-sm text-ink-muted">{t.needsInstall}</p>}
      {blocked && <p className="text-sm text-ink-muted">{t.blocked}</p>}

      {ready !== null && !blocked && device === null && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void turnOn(ready.publicKey)}
          className={`${PRIMARY_BUTTON} self-start`}
        >
          {busy === 'on' ? t.turningOn : t.turnOn}
        </button>
      )}

      {!blocked && device !== null && (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t.topicsLegend}</legend>
            {PUSH_TOPICS.map((topic) => (
              <label key={topic} className="flex w-fit cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={device.topics.includes(topic)}
                  disabled={busy === 'topics'}
                  onChange={(event) => void setTopic(device, topic, event.target.checked)}
                  aria-describedby={`push-topic-${topic}`}
                  className="focus-ring mt-0.5 size-4.5 shrink-0 cursor-pointer accent-accent"
                />
                <span className="flex flex-col">
                  {t.topics[topic].label}
                  <span id={`push-topic-${topic}`} className="text-ink-muted">
                    {topicHint(topic)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void sendTest()}
              className={SECONDARY_BUTTON}
            >
              {busy === 'test' ? t.sendingTest : t.sendTest}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void turnOff(device)}
              className={SECONDARY_BUTTON}
            >
              {busy === 'off' ? t.turningOff : t.turnOff}
            </button>
          </div>
          {testNote !== null && <output className="text-sm text-ink-muted">{testNote}</output>}
        </>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
});
