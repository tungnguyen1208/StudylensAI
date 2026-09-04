const defaultBackendUrl = "http://localhost:5000";

export const backendUrl =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") ?? defaultBackendUrl;

