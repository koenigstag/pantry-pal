import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { RootStore, SessionStores } from './RootStore';

const StoreContext = createContext<RootStore | null>(null);
const SessionContext = createContext<SessionStores | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): ReactElement {
  // Lazy initialiser: constructed once, not on every render.
  const [store] = useState(() => new RootStore());

  useEffect(() => {
    const stopFollowingSession = store.auth.start();
    return () => {
      stopFollowingSession();
      store.dispose();
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/**
 * The signed-in part of the app. While it is mounted the pantry is loaded and
 * its socket connected; unmounting it, as signing out does, disposes both.
 */
export function SessionStoreProvider({ children }: { children: ReactNode }): ReactElement {
  const { notices } = useRootStore();
  // Lazy initialiser: `SessionStores` creates a socket, which must happen once.
  const [stores] = useState(() => new SessionStores(notices));

  useEffect(() => {
    stores.pantry.connect();
    void stores.pantry.load();
    return () => {
      stores.dispose();
    };
  }, [stores]);

  return <SessionContext.Provider value={stores}>{children}</SessionContext.Provider>;
}

export function useRootStore(): RootStore {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error('useRootStore must be used inside <StoreProvider>');
  }
  return store;
}

function useSessionStores(): SessionStores {
  const stores = useContext(SessionContext);
  if (stores === null) {
    throw new Error(
      'The pantry exists only for a signed-in session, inside <SessionStoreProvider>',
    );
  }
  return stores;
}

export function useAuthStore(): RootStore['auth'] {
  return useRootStore().auth;
}

export function useNotices(): RootStore['notices'] {
  return useRootStore().notices;
}

export function usePantryStore(): SessionStores['pantry'] {
  return useSessionStores().pantry;
}

export function useQuantities(): SessionStores['quantities'] {
  return useSessionStores().quantities;
}
