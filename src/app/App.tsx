import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "../domain/access.ts";
import { useSession } from "./context.tsx";
import { ROUTES, hrefFor, useRoute } from "./router.ts";
import { Accounts } from "./screens/Accounts.tsx";
import { Login } from "./screens/Login.tsx";
import { Kitchen } from "./screens/Kitchen.tsx";
import { Sales } from "./screens/Sales.tsx";
import { Station } from "./screens/Station.tsx";

export function App() {
  const route = useRoute();
  const { user, signOut } = useSession();

  if (!user) return <Login />;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex min-h-14 items-center gap-2 border-b border-border bg-card px-3 sm:gap-4 sm:px-4">
        <a
          href={hrefFor("/")}
          className="font-display text-2xl leading-none text-foreground"
        >
          Karma
        </a>
        <nav
          aria-label="Secciones"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
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
        <div className="flex shrink-0 items-center gap-2">
          <p className="hidden text-right text-sm leading-tight sm:block">
            <span className="block font-medium">{user.name}</span>
            <span className="block text-xs text-muted-foreground">
              {ROLE_LABELS[user.role]}
            </span>
          </p>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut />
            <span className="sr-only sm:not-sr-only">Salir</span>
          </Button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {route === "/" && <Station />}
        {route === "/cuentas" && <Accounts />}
        {route === "/cocina" && <Kitchen />}
        {route === "/ventas" && <Sales />}
      </main>
    </div>
  );
}
