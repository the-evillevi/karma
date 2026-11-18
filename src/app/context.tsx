import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { pinDigest } from "../data/pin.ts";
import type { PosStore } from "../data/pos-store.ts";
import { findUserByPinDigest } from "../domain/access.ts";
import type { User } from "../domain/access.ts";
import type { Catalog } from "../domain/catalog.ts";
import type {
  Actor,
  CommandBatch,
  CommandMeta,
  PosState,
} from "../domain/journal.ts";
import { menuFor } from "../domain/menu.ts";
import { catalog } from "./catalog.ts";
import { localIso } from "./clock.ts";
import { newId } from "./ids.ts";

type AppContextValue = {
  store: PosStore;
  users: readonly User[];
  user: User | null;
  problem: Error | null;
  signIn: (pin: string) => Promise<boolean>;
  signOut: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppProvider is missing");
  return value;
}

const DEVICE_KEY = "karma.device.v1";

export function deviceId(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const created = `dev-${newId()}`;
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return "dev-unknown";
  }
}

type AppProviderProps = {
  store: PosStore;
  users: readonly User[];
  initialUser?: User;
  children: ReactNode;
};

export function AppProvider({
  store,
  users,
  initialUser,
  children,
}: AppProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser ?? null);
  const problem = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getProblem(),
  );
  const signIn = useCallback(
    async (pin: string) => {
      const found = findUserByPinDigest(users, await pinDigest(pin));
      setUser(found);
      return found !== null;
    },
    [users],
  );
  const signOut = useCallback(() => setUser(null), []);
  const value = useMemo(
    () => ({ store, users, user, problem, signIn, signOut }),
    [store, users, user, problem, signIn, signOut],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function usePosState(): PosState {
  const { store } = useApp();
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getState(),
  );
}

export function useMenu(): Catalog {
  const { menu } = usePosState();
  return useMemo(() => menuFor(catalog, menu), [menu]);
}

export function useSession() {
  const { user, signIn, signOut } = useApp();
  return { user, signIn, signOut };
}

export function useStoreProblem(): Error | null {
  return useApp().problem;
}

export function useActor(): Actor {
  const { user } = useApp();
  if (!user) throw new Error("No user is signed in");
  return { userId: user.userId, name: user.name, role: user.role };
}

export function useCommand() {
  const { store, user } = useApp();
  return useCallback(
    async (
      decide: (state: PosState, meta: CommandMeta) => CommandBatch,
    ): Promise<PosState> => {
      if (!user) throw new Error("No user is signed in");
      const meta: CommandMeta = {
        commandId: newId(),
        at: localIso(),
        actor: { userId: user.userId, name: user.name, role: user.role },
        deviceId: deviceId(),
      };
      return store.run((state) => decide(state, meta));
    },
    [store, user],
  );
}
