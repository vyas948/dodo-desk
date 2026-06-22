import { useState } from 'react';
import { API } from '../api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      try {
        await fetch(`${API}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      setSent(true);
    } catch (err) {
      if (err.name === 'AbortError') {
        // Request timed out — but the email may still have been sent
        setSent(true);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Forgot Password</h1>
        {sent ? (
          <div>
            <p className="text-green-600 dark:text-green-400 text-sm mb-4">
              ✅ If that email exists, a reset link has been sent. Check your inbox.
            </p>
            <a href="/login" className="text-indigo-600 dark:text-indigo-400 text-sm hover:underline">← Back to login</a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Enter your email address and we'll send you a link to reset your password.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                     placeholder="you@company.com"
                     className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
                    className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 transition font-medium disabled:opacity-50">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <div className="text-center">
              <a href="/login" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← Back to login</a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
