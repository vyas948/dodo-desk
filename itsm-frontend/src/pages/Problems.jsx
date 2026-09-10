import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { formatId } from '../utils/ticketId';

const STATUS_BADGE = {
  open:             'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress:      'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  pending_approval: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  resolved:         'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  closed:           'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};
const ALL_STATUSES = ['open', 'in_progress', 'pending_approval', 'resolved', 'closed'];

export default function Problems() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [problems, setProblems]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [knownErrorOnly, setKnownErrorOnly] = useState(false);
  const [searchTerm, setSearchTerm]     = useState('');
  const [upgradeRequired, setUpgradeRequired] = useState(false);

  const fetchProblems = () => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    apiFetch(`/problems?${params}`, token)
      .then(data => { setProblems(Array.isArray(data) ? data : []); setUpgradeRequired(false); })
      .catch(err => {
        if (err.message && err.message.toLowerCase().includes('plan')) {
          setUpgradeRequired(true);
        } else {
          toast.error(err.message);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchProblems, [token, statusFilter]);

  const visible = problems
    .filter(p => !knownErrorOnly || p.is_known_error)
    .filter(p => !searchTerm.trim() || p.title.toLowerCase().includes(searchTerm.trim().toLowerCase()));

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">🔴 Problems</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Root-cause tickets that other incidents are linked to — your known-error tracking.
            </p>
          </div>
        </div>

        {upgradeRequired ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">Problem management is available on the Pro plan and above.</p>
            <Link to="/settings?tab=billing" className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm font-medium">Upgrade to Pro →</Link>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div className="flex gap-3 mb-5 flex-wrap items-center">
              <div className="relative flex-1 min-w-48">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                       placeholder="Search problems..."
                       className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                <option value="">All statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={knownErrorOnly} onChange={e => setKnownErrorOnly(e.target.checked)}
                       className="rounded border-gray-300 dark:border-gray-600" />
                🏷️ Known errors only
              </label>
            </div>

            {loading ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
                <p className="text-gray-400">Loading...</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
                <p className="text-gray-400 text-sm">
                  {problems.length === 0
                    ? 'No problems yet. Link an incident to a root-cause ticket from the ticket detail page to see it here.'
                    : `No problems match your filters.`}
                </p>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">ID</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Title</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Known Error</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Linked Incidents</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Assigned To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {visible.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-5 py-4 text-sm font-medium">
                            <Link to={`/tickets/${p.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline font-mono">{formatId(p.id, 'incident')}</Link>
                          </td>
                          <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate">{p.title}</td>
                          <td className="px-5 py-4">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[p.status] || ''}`}>{p.status?.replace(/_/g,' ')}</span>
                          </td>
                          <td className="px-5 py-4 text-sm">
                            {p.is_known_error
                              ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">🏷️ Known Error</span>
                              : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{p.linked_incident_count}</td>
                          <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{p.assigned_to_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
