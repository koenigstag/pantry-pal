import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { RootStore } from './RootStore';

const StoreContext = createContext<RootStore | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): ReactElement {
  // Lazy initialiser: `new RootStore()` creates a socket, so it must run once and
  // not on every render.
  const [store] = useState(() => new RootStore());

  useEffect(() => {
    store.pantry.connect();
    void store.pantry.load();
    return () => {
      store.dispose();
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useRootStore(): RootStore {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error('useRootStore must be used inside <StoreProvider>');
  }
  return store;
}

export function usePantryStore(): RootStore['pantry'] {
  return useRootStore().pantry;
}

export function useQuantities(): RootStore['quantities'] {
  return useRootStore().quantities;
}

export function useNotices(): RootStore['notices'] {
  return useRootStore().notices;
}
