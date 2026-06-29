import { Link, useLocation } from 'react-router-dom';

// Map routes to breadcrumb trails
function getCrumbs(pathname) {
  // Dashboard — no breadcrumb
  if (pathname === '/') return null;

  // Static routes
  const staticMap = {
    '/create-ticket':   [{ label: 'Dashboard', to: '/' }, { label: 'New Ticket' }],
    '/kb':              [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base' }],
    '/kb/new':          [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base', to: '/kb' }, { label: 'New Article' }],
    '/assets':          [{ label: 'Dashboard', to: '/' }, { label: 'Assets' }],
    '/assets/new':      [{ label: 'Dashboard', to: '/' }, { label: 'Assets', to: '/assets' }, { label: 'New Asset' }],
    '/changes':         [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests' }],
    '/changes/new':     [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests', to: '/changes' }, { label: 'New Change' }],
    '/catalog':         [{ label: 'Dashboard', to: '/' }, { label: 'Service Catalog' }],
    '/reports':         [{ label: 'Dashboard', to: '/' }, { label: 'Reports' }],
    '/canned-responses':[{ label: 'Dashboard', to: '/' }, { label: 'Canned Responses' }],
    '/settings':        [{ label: 'Dashboard', to: '/' }, { label: 'Settings' }],
    '/admin/users':     [{ label: 'Dashboard', to: '/' }, { label: 'Settings', to: '/settings' }, { label: 'Users' }],
  };

  if (staticMap[pathname]) return staticMap[pathname];

  // Dynamic routes
  const ticketMatch = pathname.match(/^\/tickets\/(\d+)/);
  if (ticketMatch) return [{ label: 'Dashboard', to: '/' }, { label: `Ticket #${ticketMatch[1]}` }];

  const kbMatch = pathname.match(/^\/kb\/(\d+)/);
  if (kbMatch) return [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base', to: '/kb' }, { label: 'Article' }];

  const assetMatch = pathname.match(/^\/assets\/(\d+)/);
  if (assetMatch) return [{ label: 'Dashboard', to: '/' }, { label: 'Assets', to: '/assets' }, { label: `Asset #${assetMatch[1]}` }];

  const changeMatch = pathname.match(/^\/changes\/(\d+)/);
  if (changeMatch) return [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests', to: '/changes' }, { label: `CHG #${changeMatch[1]}` }];

  const editUserMatch = pathname.match(/^\/admin\/users\/.+\/edit/);
  if (editUserMatch) return [{ label: 'Dashboard', to: '/' }, { label: 'Users', to: '/admin/users' }, { label: 'Edit User' }];

  return null;
}

export default function Breadcrumb() {
  const location = useLocation();
  const crumbs = getCrumbs(location.pathname);
  if (!crumbs) return null;

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
              <Link to={crumb.to} className="hover:text-indigo-500 dark:hover:text-indigo-400 transition">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
