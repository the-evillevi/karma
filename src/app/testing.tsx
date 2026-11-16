// Helpers for screen tests. Not imported by app code.
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { PosStore, createMemoryStorage } from "../data/pos-store.ts";
import type { JournalStorage } from "../data/pos-store.ts";
import type { Role, User } from "../domain/access.ts";
import { AppProvider } from "./context.tsx";
import { resetDraftCache } from "./draft.ts";
import { ToastProvider } from "./toast.tsx";
import { PILOT_USERS } from "./users.ts";

export function pilotUser(role: Role): User {
  const user = PILOT_USERS.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`No pilot user with role ${role}`);
  return user;
}

type RenderAppOptions = {
  /** Signed-in role; omit to start at the PIN screen. */
  as?: Role;
  storage?: JournalStorage;
  users?: readonly User[];
};

/** Renders `ui` inside the app providers over an in-memory journal. */
export async function renderApp(ui: ReactNode, options: RenderAppOptions = {}) {
  resetDraftCache();
  const storage = options.storage ?? createMemoryStorage();
  const store = await PosStore.open(storage);
  const view = render(
    <AppProvider
      store={store}
      users={options.users ?? PILOT_USERS}
      initialUser={options.as ? pilotUser(options.as) : undefined}
    >
      <ToastProvider>{ui}</ToastProvider>
    </AppProvider>,
  );
  return { ...view, store, storage };
}
