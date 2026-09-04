import { backendUrl } from "../config";

export interface HealthResponse {
  status: string;
  service: string;
}

export async function getBackendHealth(): Promise<HealthResponse> {
  const response = await fetch(`${backendUrl}/api/health`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Backend health check failed with status ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}

