export type DiagnosticKind =
  "offline" | "permission" | "storage" | "conflict" | "server" | "unknown";
export interface SafeDiagnostic {
  kind: DiagnosticKind;
  code: string;
  message: string;
  retryable: boolean;
}
export declare function safeDiagnostic(error: unknown): SafeDiagnostic;
