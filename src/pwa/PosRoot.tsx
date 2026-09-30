import React, { useCallback } from "react";
import PosApp from "../PosApp.jsx";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { PwaUpdateControl } from "./PwaUpdateControl";
import { reportUpdateSafety, type UpdateSafetySnapshot } from "./update-safety";

interface Props {
  vistaCatalogo: string;
  mostrarAgotados: boolean;
  propinaInicial: string;
}

export function PosRoot(props: Props): React.ReactNode {
  const report = useCallback(
    (safety: UpdateSafetySnapshot) => reportUpdateSafety(safety),
    [],
  );
  return (
    <AppErrorBoundary>
      <PosApp {...props} onUpdateSafetyChange={report} />
      <PwaUpdateControl />
    </AppErrorBoundary>
  );
}
