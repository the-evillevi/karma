export function posAccessStorageKey(
  mode: "secure" | "demo",
  branchId?: string,
  deviceId?: string,
): string {
  if (mode === "demo") return "karma-pos-v1";
  return `karma-pos-secure-v1:${encodeURIComponent(branchId ?? "unconfigured")}:${encodeURIComponent(deviceId ?? "unconfigured")}`;
}
