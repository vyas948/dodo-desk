import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const QUICK_LINKS = [
  { to: '/',              icon: '🏠', label: 'Dashboard' },
  { to: '/create-ticket', icon: '🎫', label: 'New Ticket' },
  { to: '/kb',            icon: '📚', label: 'Knowledge Base' },
  { to: '/assets',        icon: '💻', label: 'Assets' },
  { to: '/reports',       icon: '📊', label: 'Reports' },
  { to: '/settings',      icon: '⚙️', label: 'Settings' },
];

export default function NotFound() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { token } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center">

        <div className="text-8xl mb-6 select-none" role="img" aria-label="Lost dodo bird">🦤</div>

        <h1 className="text-6xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">404</h1>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Page not found</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          The page at{' '}
          <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono text-indigo-600 dark:text-indigo-400">
            {location.pathname}
          </code>{' '}
          doesn't exist.
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-8">
          It may have been moved, deleted, or you may have mistyped the URL.
        </p>

        <div className="flex gap-3 justify-center mb-8">
          <button onClick={() => navigate(-1)}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
            ← Go back
          </button>
          <Link to="/" className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition">
            Go to Dashboard
          </Link>
        </div>

        {token && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Quick links</p>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_LINKS.map(l => (
                <Link key={l.to} to={l.to}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition group">
                  <span className="text-xl">{l.icon}</span>
                  <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">{l.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-600 mt-6">
          DodoDesk · If you think this is a bug, contact your administrator.
        </p>
      </div>
    </div>
  );
}
