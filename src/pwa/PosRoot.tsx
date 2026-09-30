import React, { useCallback } from "react";
import PosApp from "../PosApp.jsx";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { PwaUpdateControl } from "./PwaUpdateControl";
import { reportUpdateSafety, type UpdateSafetySnapshot } from "./update-safety";
import { usePosAccess } from "../access/pos-access.tsx";

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
  const access = usePosAccess();
  return (
    <AppErrorBoundary>
      <PosApp
        {...props}
        accessMode={access.mode}
        accessStorageKey={access.storageKey}
        accessBranchId={access.expectedBranchId}
        accessDeviceId={access.expectedDeviceId}
        accessContext={access.context}
        accessScreen={access.accessScreen}
        accessControls={access.accessControls}
        branchMembers={access.members}
        onSwitchIdentity={access.switchIdentity}
        onManageMember={access.onManageMember}
        onCreateMember={access.onCreateMember}
        onSetMemberActive={access.onSetMemberActive}
        onUpdateSafetyChange={report}
      />
      <PwaUpdateControl />
    </AppErrorBoundary>
  );
}
