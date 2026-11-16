// Opens the durable store in the browser: RxDB over IndexedDB (ADR-001).
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { PosStore } from "../data/pos-store.ts";
import { createRxdbStorage } from "../data/rxdb-storage.ts";

export async function openBrowserStore(): Promise<PosStore> {
  const storage = await createRxdbStorage({
    name: "karmapos",
    storage: getRxStorageDexie(),
  });
  return PosStore.open(storage);
}
