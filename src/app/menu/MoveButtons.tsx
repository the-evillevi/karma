import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MoveDirection } from "../../domain/menu.ts";

export function moveButtonId(
  idPrefix: string,
  direction: MoveDirection,
): string {
  return `${idPrefix}-${direction}`;
}

export function refocusMove(idPrefix: string, direction: MoveDirection) {
  requestAnimationFrame(() => {
    const same = document.getElementById(moveButtonId(idPrefix, direction));
    const other = document.getElementById(
      moveButtonId(idPrefix, direction === "up" ? "down" : "up"),
    );
    const target =
      same instanceof HTMLButtonElement && !same.disabled ? same : other;
    target?.focus();
  });
}

export function MoveButtons({
  idPrefix,
  label,
  isFirst,
  isLast,
  disabled,
  onMove,
}: {
  idPrefix: string;
  label: string;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMove: (direction: MoveDirection) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        id={moveButtonId(idPrefix, "up")}
        aria-label={`Subir ${label}`}
        disabled={disabled || isFirst}
        onClick={() => onMove("up")}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        id={moveButtonId(idPrefix, "down")}
        aria-label={`Bajar ${label}`}
        disabled={disabled || isLast}
        onClick={() => onMove("down")}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
    </span>
  );
}
