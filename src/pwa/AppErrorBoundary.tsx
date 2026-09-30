import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { safeDiagnostic } from "../offline-sync/sync-diagnostic.js";

interface Props {
  children: ReactNode;
}

interface State {
  renderError: boolean;
  diagnostic: string | null;
  asyncFailure: string | null;
}

/** Catches render and uncaught async failures without displaying exception messages or payloads. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { renderError: false, diagnostic: null, asyncFailure: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { renderError: true, diagnostic: safeDiagnostic(error).code };
  }

  componentDidMount(): void {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleRejection);
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleRejection);
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    void _info;
    this.setState({ diagnostic: safeDiagnostic(error).code });
  }

  private handleWindowError = (event: ErrorEvent): void => {
    const diagnostic = safeDiagnostic(event.error ?? { name: "Error" });
    event.preventDefault();
    this.setState({ asyncFailure: diagnostic.code });
  };

  private handleRejection = (event: PromiseRejectionEvent): void => {
    const diagnostic = safeDiagnostic(event.reason);
    event.preventDefault();
    this.setState({ asyncFailure: diagnostic.code });
  };

  render(): ReactNode {
    if (this.state.renderError) {
      return (
        <main role="alert" style={styles.fatal}>
          <h1>La aplicación no pudo abrir esta pantalla</h1>
          <p>
            Cierra la aplicación y vuelve a abrirla cuando la estación esté
            segura. Pide apoyo si el problema continúa.
          </p>
          <Diagnostic code={this.state.diagnostic} />
        </main>
      );
    }
    return (
      <>
        {this.props.children}
        {this.state.asyncFailure && (
          <div role="alert" aria-live="assertive" style={styles.asyncAlert}>
            <span>
              Una operación no terminó correctamente. Revisa el estado antes de
              repetirla.
            </span>
            <Diagnostic code={this.state.asyncFailure} />
            <button onClick={() => this.setState({ asyncFailure: null })}>
              Entendido
            </button>
          </div>
        )}
      </>
    );
  }
}

function Diagnostic({ code }: { code: string | null }): ReactNode {
  return <small>Código de diagnóstico: {code || "UNCLASSIFIED"}</small>;
}

const styles: Record<string, React.CSSProperties> = {
  fatal: {
    minHeight: "100vh",
    boxSizing: "border-box",
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: 12,
    padding: 24,
    color: "#141413",
    background: "#f0eee6",
    fontFamily: "system-ui, sans-serif",
    textAlign: "center",
  },
  asyncAlert: {
    position: "fixed",
    zIndex: 10000,
    left: 16,
    right: 16,
    bottom: 16,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    border: "1px solid #836953",
    borderRadius: 12,
    background: "#faf9f5",
    color: "#141413",
    fontFamily: "system-ui, sans-serif",
  },
};
