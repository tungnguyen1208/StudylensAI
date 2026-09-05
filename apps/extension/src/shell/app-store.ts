export interface AppState {
  isInitialized: boolean;
  activeVideoId: string | null;
}

export const initialAppState: AppState = {
  isInitialized: true,
  activeVideoId: null,
};
