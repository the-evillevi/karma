import { useRef, useState, type MouseEvent } from "react";
import { badgeVariants } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PREPARATION_LABELS,
  durationLabel,
  timeInStatus,
  totalMinutes,
} from "../../domain/comanda.ts";
import type { Comanda } from "../../domain/journal.ts";

export function StatusPill({
  comanda,
  now,
}: {
  comanda: Comanda;
  now: string;
}) {
  const [open, setOpen] = useState(false);
  const openOnPointerDown = useRef(false);
  const times = timeInStatus(comanda, now);
  const currentMinutes = times.find((time) => time.current)?.minutes ?? 0;

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const wasOpen = event.detail === 0 ? open : openOnPointerDown.current;
    setOpen(!wasOpen);
  }

  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              badgeVariants({
                variant: comanda.status === "queued" ? "pending" : "outline",
              }),
              "relative overflow-visible after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']",
            )}
            onPointerDown={() => {
              openOnPointerDown.current = open;
            }}
            onClick={toggle}
          >
            <span>{PREPARATION_LABELS[comanda.status]}</span>
            <span className="tabular-nums">
              · {durationLabel(currentMinutes)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="min-w-44 py-2">
          <p className="pb-1.5 font-medium">Tiempo en cada estado</p>
          <ul className="flex flex-col gap-1">
            {times.map((time, index) => (
              <li
                key={`${time.status}-${index}`}
                className={cn(
                  "flex items-center justify-between gap-4",
                  time.current ? "font-medium" : "text-background/70",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full border border-current",
                      time.current && "bg-current",
                    )}
                  />
                  <span>{PREPARATION_LABELS[time.status]}</span>
                </span>
                <span className="tabular-nums">
                  {durationLabel(time.minutes)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex justify-between gap-4 border-t border-background/20 pt-1.5 font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {durationLabel(totalMinutes(comanda, now))}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
