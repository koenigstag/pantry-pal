import type { OAuthConnections } from '@pantry-pal/shared';
import { Check, Copy } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { formatInstant } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { SECONDARY_BUTTON } from '../auth/AuthPage';

/**
 * The Profile page's connected assistants: the MCP address to give claude.ai or
 * ChatGPT, and each assistant the user allowed, which they can disconnect.
 * Online only; offline, it says it could not load.
 */
export const ConnectionsSection = observer(function ConnectionsSection(): ReactElement {
  const pantry = usePantryStore();
  const [data, setData] = useState<OAuthConnections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const t = messages.connections;

  const load = useCallback(async (): Promise<void> => {
    const result = await pantry.connections();
    if (result.ok) {
      setData(result.value);
      setError(null);
    } else setError(t.loadFailed);
  }, [pantry, t.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard here: the address stays on screen to select by hand.
    }
  }

  async function disconnect(id: string): Promise<void> {
    setBusyId(id);
    const failure = await pantry.disconnect(id);
    setBusyId(null);
    if (failure !== null) setError(failure);
    await load();
  }

  return (
    <section className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <h2 className="font-semibold">{t.title}</h2>
      <p className="text-sm text-ink-muted">{t.intro}</p>

      {data !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-56 rounded-lg bg-sunken px-3 py-2 text-sm break-all select-all">
            {data.mcpUrl}
          </code>
          <button type="button" onClick={() => void copy(data.mcpUrl)} className={SECONDARY_BUTTON}>
            {copied ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <Copy aria-hidden="true" className="size-4" />
            )}
            {copied ? t.copied : t.copy}
          </button>
        </div>
      )}

      {data !== null &&
        (data.connections.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.none}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.connections.map((connection) => (
              <li key={connection.id} className="flex items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{connection.clientName}</span>
                  <span className="text-xs text-ink-muted">
                    {t.since(formatInstant(connection.createdAt))}
                    {connection.lastUsedAt !== null &&
                      ` · ${t.lastUsed(formatInstant(connection.lastUsedAt))}`}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void disconnect(connection.id)}
                  className={SECONDARY_BUTTON}
                >
                  {busyId === connection.id ? t.disconnecting : t.disconnect}
                </button>
              </li>
            ))}
          </ul>
        ))}

      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
});
