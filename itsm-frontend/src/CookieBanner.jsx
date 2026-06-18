import { useState, useEffect } from 'react';

const COOKIE_KEY = 'dododesk_cookie_consent';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show banner only if user hasn't already made a choice
    const consent = localStorage.getItem(COOKIE_KEY);
    if (!consent) {
      // Small delay so it doesn't flash instantly on load
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_KEY, 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(COOKIE_KEY, 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Icon */}
        <div className="text-2xl flex-shrink-0">🍪</div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-white mb-0.5">
            We use cookies
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            DodoDesk uses essential cookies to keep you signed in and remember your preferences.
            We don't use tracking, advertising, or analytics cookies.{' '}
            <a href="/privacy" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Learn more
            </a>
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
          <button
            onClick={handleDecline}
            className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
