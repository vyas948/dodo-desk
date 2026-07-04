import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { API } from '../api';

export default function ConfirmEmailChange() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('Invalid confirmation link.'); return; }
    fetch(`${API}/auth/confirm-email-change?token=${token}`, { method: 'GET' })
      .then(res => {
        if (res.ok || res.redirected) {
          setStatus('success');
          setMessage('Your email address has been updated. Please log in with your new email.');
        } else {
          return res.json().then(d => { throw new Error(d.detail || 'Confirmation failed.'); });
        }
      })
      .catch(e => { setStatus('error'); setMessage(e.message); });
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-xl p-10 w-full max-w-md text-center">
        {status === 'loading' && (
          <>
            <div className="flex justify-center mb-4">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"/>
            </div>
            <p className="text-gray-500">Confirming your new email address...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Email Updated!</h2>
            <p className="text-gray-500 text-sm mb-6">{message}</p>
            <Link to="/login" className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition">
              Log in with new email →
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Confirmation Failed</h2>
            <p className="text-gray-500 text-sm mb-6">{message}</p>
            <Link to="/settings" className="text-indigo-600 hover:underline text-sm">
              Back to Settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
