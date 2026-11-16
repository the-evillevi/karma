import { Delete } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSession } from "../context.tsx";

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const keyClass =
  "flex h-16 items-center justify-center rounded-[var(--radius-card)] border border-border bg-card text-2xl tabular-nums outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring active:bg-accent disabled:opacity-60";

export function Login() {
  const { signIn } = useSession();
  const [pin, setPin] = useState("");
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  async function press(digit: string) {
    if (checking || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setFailed(false);
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    setChecking(true);
    const accepted = await signIn(next);
    setChecking(false);
    if (!accepted) {
      setFailed(true);
      setPin("");
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background p-6 text-foreground">
      <div className="flex flex-col items-center gap-2">
        <p className="font-display text-5xl leading-none">Karma</p>
        <h1 className="text-sm text-muted-foreground">
          Captura tu PIN para entrar
        </h1>
      </div>

      <div
        role="status"
        aria-label={`${pin.length} de ${PIN_LENGTH} dígitos capturados`}
        className="flex gap-3"
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={cn(
              "size-4 rounded-full border border-primary",
              index < pin.length && "bg-primary",
            )}
          />
        ))}
      </div>

      <p role="alert" className="min-h-5 text-sm font-medium">
        {failed ? "PIN incorrecto" : ""}
      </p>

      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={keyClass}
            disabled={checking}
            onClick={() => press(digit)}
          >
            {digit}
          </button>
        ))}
        <span />
        <button
          type="button"
          className={keyClass}
          disabled={checking}
          onClick={() => press("0")}
        >
          0
        </button>
        <button
          type="button"
          aria-label="Borrar"
          className={keyClass}
          disabled={checking || pin.length === 0}
          onClick={() => {
            setFailed(false);
            setPin(pin.slice(0, -1));
          }}
        >
          <Delete className="size-6" />
        </button>
      </div>
    </main>
  );
}
