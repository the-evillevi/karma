import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { App } from "./App.tsx";
import { openBrowserStore } from "./boot.ts";
import { AppProvider } from "./context.tsx";
import { ToastProvider } from "./toast.tsx";
import { PILOT_USERS } from "./users.ts";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
const root = createRoot(container);

function Notice({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-background p-6 text-center text-foreground">
      <p className="font-display text-4xl leading-none">Karma</p>
      <h1 className="text-base font-medium">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>
    </main>
  );
}

root.render(
  <Notice
    title="Cargando estación"
    detail="Abriendo los datos guardados en este dispositivo."
  />,
);

openBrowserStore().then(
  (store) =>
    root.render(
      <StrictMode>
        <AppProvider store={store} users={PILOT_USERS}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AppProvider>
      </StrictMode>,
    ),
  (error: unknown) => {
    console.error(error);
    root.render(
      <Notice
        title="No se pudieron abrir los datos de este dispositivo"
        detail="No se puede vender sin guardar. Cierra otras ventanas de Karma y recarga; si continúa, avisa al administrador."
      />,
    );
  },
);
