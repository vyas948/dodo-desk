import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../apiFetch';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('');
  const [planSelected, setPlanSelected] = useState('free');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token found. Please check your email link.');
      return;
    }
    apiFetch(`/auth/verify-email?token=${encodeURIComponent(token)}`, null)
      .then(data => {
        login(data.access_token);
        setPlanSelected(data.plan_selected || 'free');
        setStatus('success');
        setMessage(data.message || 'Email verified successfully!');
        if (data.plan_selected === 'pro') {
          setTimeout(() => navigate('/admin/settings?tab=tenants&checkout=pro'), 1500);
        } else {
          setTimeout(() => navigate('/dashboard'), 1500);
        }
      })
      .catch(err => {
        setStatus('error');
        setMessage(err.message || 'Verification failed. The link may be invalid or expired.');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 w-full max-w-md text-center">
        {status === 'verifying' && (
          <>
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <svg className="w-8 h-8 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Verifying your email…</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Just a moment while we activate your account.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Email verified!</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{message}</p>
            {planSelected === 'pro' ? (
              <p className="text-sm text-indigo-600 dark:text-indigo-400">Taking you to checkout…</p>
            ) : (
              <p className="text-sm text-gray-400">Taking you to your dashboard…</p>
            )}
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Verification failed</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{message}</p>
            <div className="flex flex-col gap-2">
              <Link to="/signup" className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition text-center">Sign up again</Link>
              <Link to="/login" className="w-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition text-center">Back to login</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
