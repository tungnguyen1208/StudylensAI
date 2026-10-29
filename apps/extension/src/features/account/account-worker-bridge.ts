export const ACCOUNT_REQUEST_MESSAGE = 'STUDYLENS_ACCOUNT_REQUEST' as const;

export interface StudyLensAccount {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  pictureUrl?: string;
}

export interface QuotaCounter {
  resourceType: 'quizGenerate' | 'transcriptGenerate' | 'shortAnswerGrade';
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  resetAtUtc: string;
}

export interface AccountStatus {
  authenticated: boolean;
  account?: StudyLensAccount;
  quota?: QuotaCounter[];
  error?: string;
}

type AccountRequest =
  | { operation: 'status' | 'signOut' | 'quota' }
  | { operation: 'signIn'; username: string; password: string }
  | { operation: 'register'; username: string; password: string; displayName: string }
  | { operation: 'changePassword'; currentPassword: string; newPassword: string };

async function request(request: AccountRequest): Promise<AccountStatus> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return { authenticated: false, error: 'extensionRuntimeUnavailable' };
  return chrome.runtime.sendMessage({ type: ACCOUNT_REQUEST_MESSAGE, ...request }) as Promise<AccountStatus>;
}

export const accountBridge = {
  status: () => request({ operation: 'status' }),
  signIn: (username: string, password: string) => request({ operation: 'signIn', username, password }),
  register: (username: string, password: string, displayName: string) => request({ operation: 'register', username, password, displayName }),
  signOut: () => request({ operation: 'signOut' }),
  quota: () => request({ operation: 'quota' }),
  changePassword: (currentPassword: string, newPassword: string) => request({ operation: 'changePassword', currentPassword, newPassword }),
};
