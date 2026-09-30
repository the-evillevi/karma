import React, { useCallback } from "react";
import ComandaApp from "../ComandaApp.jsx";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { PwaUpdateControl } from "./PwaUpdateControl";
import { reportUpdateSafety, type UpdateSafetySnapshot } from "./update-safety";

export function ComandaRoot(): React.ReactNode {
  const report = useCallback(
    (safety: UpdateSafetySnapshot) => reportUpdateSafety(safety),
    [],
  );
  return (
    <AppErrorBoundary>
      <ComandaApp onUpdateSafetyChange={report} />
      <PwaUpdateControl />
    </AppErrorBoundary>
  );
}
