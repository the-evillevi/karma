// PIN digests. Web Crypto works offline, so signing in never needs the network.

/** SHA-256 digest (hex) of a PIN, salted with an app-specific prefix. */
export async function pinDigest(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`karma-pos-pin:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
