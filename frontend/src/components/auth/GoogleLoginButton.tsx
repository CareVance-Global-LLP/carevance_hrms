import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface GoogleLoginButtonProps {
  type?: 'login' | 'signup';
}

export default function GoogleLoginButton({ type = 'login' }: GoogleLoginButtonProps) {
  const navigate = useNavigate();
  const { googleLogin } = useAuth();
  const [error, setError] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState(false);
  const hasMounted = useRef(false);

  const isDesktopApp = typeof window !== 'undefined' &&
    Boolean((window as any).desktopTracker);

  const handleCredential = async (credential: string) => {
    setError('');

    try {
      const currentSearch = window.location.search;
      sessionStorage.setItem('google_signup_fallback_params', currentSearch);

      const result = await googleLogin(credential);

      const hasWorkspace = (result as any).has_workspace === true ||
        ((result as any).needs_completion === false && !(result as any).is_new_user);
      const needsCompletion = (result as any).has_workspace === false ||
        (result as any).needs_completion === true ||
        (result as any).is_new_user === true;

      if (hasWorkspace && !needsCompletion) {
        if (isDesktopApp) {
          setShowSuccess(true);
          setTimeout(() => {
            navigate('/dashboard');
          }, 2000);
        } else {
          navigate('/dashboard');
        }
      } else {
        const fallbackParams = sessionStorage.getItem('google_signup_fallback_params') || '';
        const params = new URLSearchParams(fallbackParams || window.location.search);
        sessionStorage.removeItem('google_signup_fallback_params');

        const googleData = (result as any).google_data || {};
        if (googleData.name) params.set('google_name', googleData.name);
        if (googleData.email) params.set('google_email', googleData.email);
        navigate(`/signup-owner?${params.toString()}`);
      }
    } catch (err: any) {
      console.error('Google login error:', err);
      setError(err.message || 'Google authentication failed. Please try again.');
    }
  };

  const handleSuccess = async (credentialResponse: CredentialResponse) => {
    if (credentialResponse.credential) {
      await handleCredential(credentialResponse.credential);
    } else {
      setError('Authentication succeeded but no credential received. Please try again.');
    }
  };

  const handleError = (errorResponse?: any) => {
    if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) {
      setError('Google Client ID is not configured. Please check your environment variables.');
    } else {
      setError('Google login failed. Check browser console for details.');
    }
  };

  const isEnabled = import.meta.env.VITE_GOOGLE_OAUTH_ENABLED === 'true' &&
                    import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (!isEnabled) {
    return null;
  }

  if (showSuccess) {
    return (
      <div className="w-full rounded-2xl bg-green-50 border border-green-200 p-6 text-center">
        <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-green-800 mb-1">
          Successfully Signed In!
        </h3>
        <p className="text-sm text-green-700">
          Opening CareVance Desktop...
        </p>
      </div>
    );
  }

  // Prevent double initialization in React StrictMode
  if (!hasMounted.current) {
    hasMounted.current = true;
  }

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/90 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {hasMounted.current && (
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
      )}
    </div>
  );
}
