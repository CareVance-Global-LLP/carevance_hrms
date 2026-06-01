import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { AlertCircle } from 'lucide-react';

interface GoogleLoginButtonProps {
  type?: 'login' | 'signup';
}

export default function GoogleLoginButton({ type = 'login' }: GoogleLoginButtonProps) {
  const navigate = useNavigate();
  const { googleLogin } = useAuth();
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSuccess = async (credentialResponse: CredentialResponse) => {
    setError('');
    setIsLoading(true);

    try {
      if (credentialResponse.credential) {
        // Save current URL params BEFORE Google API call (in case redirect strips them)
        const currentSearch = window.location.search;
        sessionStorage.setItem('google_signup_fallback_params', currentSearch);

        const result = await googleLogin(credentialResponse.credential);

        // Support both new backend (has_workspace) and old backend (needs_completion)
        const hasWorkspace = (result as any).has_workspace === true ||
          ((result as any).needs_completion === false && !(result as any).is_new_user);
        const needsCompletion = (result as any).has_workspace === false ||
          (result as any).needs_completion === true ||
          (result as any).is_new_user === true;

        if (hasWorkspace && !needsCompletion) {
          navigate('/dashboard');
        } else {
          // No workspace yet - redirect to owner signup with pre-filled Google data
          // Restore original params from sessionStorage, fallback to current URL
          const fallbackParams = sessionStorage.getItem('google_signup_fallback_params') || '';
          const params = new URLSearchParams(fallbackParams || window.location.search);
          sessionStorage.removeItem('google_signup_fallback_params');

          const googleData = (result as any).google_data || {};
          if (googleData.name) params.set('google_name', googleData.name);
          if (googleData.email) params.set('google_email', googleData.email);
          navigate(`/signup-owner?${params.toString()}`);
        }
      }
    } catch (err: any) {
      console.error('Google login error:', err);
      setError(err.message || 'Google authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleError = () => {
    setError('Google login was cancelled or failed. Please try again.');
  };

  const isEnabled = import.meta.env.VITE_GOOGLE_OAUTH_ENABLED === 'true' &&
                    import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (!isEnabled) {
    return null;
  }

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/90 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-center">
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={handleError}
        text={type === 'signup' ? 'signup_with' : 'signin_with'}
        shape="pill"
        theme="outline"
        size="large"
        width={300}
      />
      </div>
    </div>
  );
}
