import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * SSO Callback page — handles redirect from /auth/sso/callback backend.
 * The backend redirects to: /sso-callback#token=JWT&email=user@company.com
 * This page reads the token from the URL fragment (never query string for security)
 * and logs the user in.
 */
export default function SsoCallback() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState('processing');
  const [error, setError] = useState('');

  useEffect(() => {
    const hash = window.location.hash.substring(1); // remove leading #
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    const errorParam = new URLSearchParams(window.location.search).get('error');

    if (errorParam) {
      const errorMessages = {
        org_not_found:      'Organisation not found.',
        saml_failed:        'SSO authentication failed. Please try again or contact your IT administrator.',
        not_authenticated:  'Authentication was not completed. Please try again.',
        no_email:           'Your identity provider did not return an email address.',
        domain_mismatch:    'Your email domain is not authorised for this organisation.',
        account_disabled:   'Your account has been disabled. Please contact your administrator.',
        sso_error:          'An unexpected error occurred during SSO. Please try again.',
      };
      setError(errorMessages[errorParam] || 'SSO login failed. Please try again.');
      setStatus('error');
      return;
    }

    if (!token) {
      setError('No authentication token received. Please try again.');
      setStatus('error');
      return;
    }

    // Store token and redirect to dashboard
    try {
      login(token);
      // Clear the hash from URL for security (token shouldn't stay in browser history)
      window.history.replaceState({}, document.title, '/sso-callback');
      setStatus('success');
      setTimeout(() => navigate('/'), 500);
    } catch (e) {
      setError('Failed to complete login. Please try again.');
      setStatus('error');
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        {status === 'processing' && (
          <>
            <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Completing sign-in…</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Please wait while we verify your identity.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="text-4xl mb-4">✅</div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Signed in successfully</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Redirecting to your dashboard…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-4xl mb-4">❌</div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">Sign-in failed</h2>
            <p className="text-sm text-red-600 dark:text-red-400 mb-6">{error}</p>
            <button
              onClick={() => navigate('/login')}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition"
            >
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
