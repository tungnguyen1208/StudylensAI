import { useEffect, useState } from "react";
import { getBackendHealth, type HealthResponse } from "../api/api-client";
import { backendUrl } from "../config";
import "./styles.css";

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; value: HealthResponse }
  | { kind: "error"; message: string };

export function App() {
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let isMounted = true;

    getBackendHealth()
      .then((value) => {
        if (isMounted) {
          setHealth({ kind: "ok", value });
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setHealth({
            kind: "error",
            message: error instanceof Error ? error.message : "Backend is unavailable"
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="shell">
      <section className="statusPanel" aria-labelledby="studylens-title">
        <p className="eyebrow">YouTube learning companion</p>
        <h1 id="studylens-title">StudyLens AI</h1>
        <div className={`statusBadge statusBadge-${health.kind}`}>
          {health.kind === "loading" && "Checking backend"}
          {health.kind === "ok" && "Backend connected"}
          {health.kind === "error" && "Backend unavailable"}
        </div>
        <dl className="healthList">
          <div>
            <dt>Backend URL</dt>
            <dd>{backendUrl}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{health.kind === "ok" ? `${health.value.service}: ${health.value.status}` : health.kind}</dd>
          </div>
        </dl>
        {health.kind === "error" && <p className="errorText">{health.message}</p>}
      </section>
    </main>
  );
}

