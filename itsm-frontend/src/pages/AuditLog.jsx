import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const ACTION_LABELS = {
  'user.created': 'User created',
  'user.updated': 'User updated',
  'user.deactivated': 'User deactivated',
  'user.activated': 'User activated',
  'tenant.plan.changed': 'Plan changed',
  'tenant.is_active.changed': 'Tenant status changed',
  'tenant.name.changed': 'Tenant renamed',
  'tenant.primary_color.changed': 'Brand color changed',
};

const ACTION_COLORS = {
  'user.created': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'user.updated': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'tenant.plan.changed': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'tenant.is_active.changed': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const badge = (action) => {
  const color = ACTION_COLORS[action] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  const label = ACTION_LABELS[action] || action;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>;
};

export default function AuditLog() {
  const { token, user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const LIMIT = 25;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT });
      if (filter) params.set('action', filter);
      const data = await apiFetch(`/admin/audit-log?${params}`, token);
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [page, filter]);

  const fmt = (dt) => dt ? new Date(dt).toLocaleString() : '—';

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Audit Log</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track all admin actions across your account</p>
          </div>
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            <option value="">All actions</option>
            <option value="user">User actions</option>
            <option value="tenant">Tenant / plan actions</option>
            <option value="branding">Branding changes</option>
          </select>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading audit log…</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No audit log entries yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">When</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Target</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{fmt(log.created_at)}</td>
                    <td className="px-4 py-3">{badge(log.action)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">{log.actor_email || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">
                      {log.target_label || log.target_id || '—'}
                      {log.target_type && <span className="ml-1 text-gray-400 dark:text-gray-500">({log.target_type})</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {log.old_value && log.new_value ? (
                        <span><span className="line-through text-red-400">{log.old_value}</span> → <span className="text-green-600 dark:text-green-400">{log.new_value}</span></span>
                      ) : log.new_value || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > LIMIT && (
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500 dark:text-gray-400">
            <span>Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                ← Prev
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * LIMIT >= total}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
