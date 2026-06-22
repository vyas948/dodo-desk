import { useState } from 'react';
import { Link } from 'react-router-dom';
import { API } from '../api';

export default function ForgotPassword() {
  const [email, setEmail]       = useState('');
  const [sent, setSent]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [resendCount, setResendCount] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(false);

  const submit = async (isResend = false) => {
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Server error');
      setSent(true);
      if (isResend) {
        setResendCount(c => c + 1);
        // Cooldown 30s between resends
        setResendCooldown(true);
        setTimeout(() => setResendCooldown(false), 30000);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 w-full max-w-md">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-1">Forgot Password</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {sent
              ? "Check your inbox for the reset link."
              : "Enter your email and we'll send you a reset link."}
          </p>
        </div>

        {sent ? (
          /* ── Success state ── */
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <p className="text-green-700 dark:text-green-400 text-sm font-medium mb-1">
                ✅ Reset link sent to <strong>{email}</strong>
              </p>
              <p className="text-green-600 dark:text-green-500 text-xs">
                Check your inbox and spam folder. The link expires in 1 hour.
              </p>
            </div>

            {/* Resend option */}
            <div className="text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Didn't receive it?
              </p>
              <button
                onClick={() => submit(true)}
                disabled={loading || resendCooldown}
                className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
              >
                {loading
                  ? 'Sending...'
                  : resendCooldown
                  ? 'Resend available in 30s'
                  : resendCount > 0
                  ? `Resend again (sent ${resendCount + 1}x)`
                  : 'Resend the link'}
              </button>
            </div>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <div className="text-center pt-2">
              <Link to="/login" className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400">
                ← Back to login
              </Link>
            </div>
          </div>

        ) : (
          /* ── Form state ── */
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="you@company.com"
                className={inputClass}
                autoFocus
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button
              onClick={() => submit()}
              disabled={loading || !email}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 transition font-medium disabled:opacity-50 text-sm"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Sending...
                </span>
              ) : 'Send Reset Link'}
            </button>

            <div className="text-center">
              <Link to="/login" className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400">
                ← Back to login
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
