import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Mock Google OAuth components to prevent "must be used within GoogleOAuthProvider" errors
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: ({ onSuccess, onError }: any) => {
    // Simulate a successful login with a dummy credential
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        onSuccess?.({ credential: 'test-credential' });
      }, 0);
    }
    return null;
  },
  CredentialResponse: class CredentialResponse {},
  useGoogleOAuth: () => ({
    signIn: () => Promise.resolve({ credential: 'test-credential' }),
  }),
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(() => {
  cleanup();
});
