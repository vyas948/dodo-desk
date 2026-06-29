import { Link, useLocation, useParams } from 'react-router-dom';
import { formatId } from './utils/ticketId';

// Route → breadcrumb config
// Each entry: { label, parent? }
// Dynamic segments (:id) are resolved at render time
const CRUMB_MAP = {
  '/':                    null,   // Dashboard has no breadcrumb
  '/create-ticket':       [{ label: 'Dashboard', to: '/' }, { label: 'New Ticket' }],
  '/tickets':             [{ label: 'Dashboard', to: '/' }, { label: 'Tickets' }],
  '/kb':                  [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base' }],
  '/kb/new':              [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base', to: '/kb' }, { label: 'New Article' }],
  '/assets':              [{ label: 'Dashboard', to: '/' }, { label: 'Assets' }],
  '/assets/new':          [{ label: 'Dashboard', to: '/' }, { label: 'Assets', to: '/assets' }, { label: 'New Asset' }],
  '/changes':             [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests' }],
  '/changes/new':         [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests', to: '/changes' }, { label: 'New Change' }],
  '/catalog':             [{ label: 'Dashboard', to: '/' }, { label: 'Service Catalog' }],
  '/reports':             [{ label: 'Dashboard', to: '/' }, { label: 'Reports' }],
  '/audit-log':           [{ label: 'Dashboard', to: '/' }, { label: 'Audit Log' }],
  '/canned-responses':    [{ label: 'Dashboard', to: '/' }, { label: 'Canned Responses' }],
  '/macros':              [{ label: 'Dashboard', to: '/' }, { label: 'Macros' }],
  '/ticket-templates':    [{ label: 'Dashboard', to: '/' }, { label: 'Ticket Templates' }],
  '/settings':            [{ label: 'Dashboard', to: '/' }, { label: 'Settings' }],
  '/groups':              [{ label: 'Dashboard', to: '/' }, { label: 'Agent Groups' }],
  '/automation':          [{ label: 'Dashboard', to: '/' }, { label: 'Automation Rules' }],
  '/workflows':           [{ label: 'Dashboard', to: '/' }, { label: 'Approval Workflows' }],
  '/admin/users':         [{ label: 'Dashboard', to: '/' }, { label: 'Settings', to: '/settings' }, { label: 'Users' }],
  '/admin/users/new':     [{ label: 'Dashboard', to: '/' }, { label: 'Settings', to: '/settings' }, { label: 'Users', to: '/admin/users' }, { label: 'New User' }],
};

export default function Breadcrumb() {
  const location = useLocation();
  const params   = useParams();
  const pathname = location.pathname;

  // Try exact match first, then pattern match for dynamic routes
  let crumbs = CRUMB_MAP[pathname];

  if (!crumbs) {
    // Dynamic routes
    if (/^\/tickets\/\d+/.test(pathname)) {
      const id = pathname.split('/')[2];
      crumbs = [
        { label: 'Dashboard', to: '/' },
        { label: 'Tickets', to: '/' },
        { label: formatId(parseInt(id), 'incident') },
      ];
    } else if (/^\/kb\/\d+/.test(pathname)) {
      crumbs = [
        { label: 'Dashboard', to: '/' },
        { label: 'Knowledge Base', to: '/kb' },
        { label: 'Article' },
      ];
    } else if (/^\/assets\/\d+/.test(pathname)) {
      const id = pathname.split('/')[2];
      crumbs = [
        { label: 'Dashboard', to: '/' },
        { label: 'Assets', to: '/assets' },
        { label: `Asset #${id}` },
      ];
    } else if (/^\/changes\/\d+/.test(pathname)) {
      const id = pathname.split('/')[2];
      crumbs = [
        { label: 'Dashboard', to: '/' },
        { label: 'Change Requests', to: '/changes' },
        { label: formatId(parseInt(id), 'change') },
      ];
    } else if (/^\/admin\/users\/.+\/edit/.test(pathname)) {
      crumbs = [
        { label: 'Dashboard', to: '/' },
        { label: 'Settings', to: '/settings' },
        { label: 'Users', to: '/admin/users' },
        { label: 'Edit User' },
      ];
    }
  }

  // Don't render on Dashboard or unknown routes
  if (!crumbs || crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mb-4 flex-wrap">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            {isLast || !crumb.to ? (
              <span className={isLast ? 'text-gray-600 dark:text-gray-300 font-medium' : ''}>
                {crumb.label}
              </span>
            ) : (
              <Link to={crumb.to}
                    className="hover:text-indigo-500 dark:hover:text-indigo-400 transition">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
