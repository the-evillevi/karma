import { cn } from "@/lib/utils";
import { ROUTES, hrefFor, useRoute } from "./router.ts";
import type { RoutePath } from "./router.ts";
import { Placeholder } from "./screens/Placeholder.tsx";
import { Station } from "./screens/Station.tsx";

const PENDING: Record<Exclude<RoutePath, "/">, string> = {
  "/cuentas": "Aquí se retoman las cuentas guardadas. Llega con EVL-122 [C].",
  "/cocina": "Aquí cocina ve las comandas pendientes. Llega con EVL-124 [B].",
  "/ventas":
    "Aquí se consultan las ventas cerradas hoy. Llega con EVL-130 [A].",
};

export function App() {
  const route = useRoute();
  const current = ROUTES.find((candidate) => candidate.path === route);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex min-h-14 items-center gap-4 border-b border-border bg-card px-4">
        <a
          href={hrefFor("/")}
          className="font-display text-2xl leading-none text-foreground"
        >
          Karma
        </a>
        <nav aria-label="Secciones" className="flex min-w-0 flex-1 gap-1">
          {ROUTES.map((candidate) => (
            <a
              key={candidate.path}
              href={hrefFor(candidate.path)}
              aria-current={candidate.path === route ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-[var(--radius-button)] px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                candidate.path === route &&
                  "bg-accent font-medium text-accent-foreground underline decoration-primary decoration-2 underline-offset-8",
              )}
            >
              {candidate.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {route === "/" ? (
          <Station />
        ) : (
          <Placeholder title={current?.label ?? ""} detail={PENDING[route]} />
        )}
      </main>
    </div>
  );
}
