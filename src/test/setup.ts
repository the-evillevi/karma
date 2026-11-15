// Vitest setup. Unmounts React trees between UI tests; domain tests run in the
// node environment and skip it, so the fast loop stays fast.
import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}
