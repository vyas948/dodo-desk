import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../apiFetch';
import { API } from '../api';
import Layout from '../components/Layout';
import { useTranslation } from '../i18n/I18nContext';

const LIMIT = 50;

// Action categories with icons and colors
const ACTION_CATEGORY = {
  user:     { icon: '👤', label: 'Users',    color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  tenant:   { icon: '🏢', label: 'Tenant',   color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  branding: { icon: '🎨', label: 'Branding', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300' },
  sla:      { icon: '⏱️', label: 'SLA',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  sla_config: { icon: '⏱️', label: 'SLA',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  security: { icon: '🔒', label: 'Security', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  security_config: { icon: '🔒', label: 'Security', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  workflow: { icon: '✅', label: 'Workflows', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  ticket:   { icon: '🎫', label: 'Tickets',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  asset:    { icon: '💻', label: 'Assets',   color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  other:    { icon: '⚙️', label: 'Other',    color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
};

// Action labels — human readable
const ACTION_LABELS = {
  'user.created': 'User created', 'user.updated': 'User updated',
  'user.deactivated': 'User deactivated', 'user.activated': 'User activated',
  'user.unlocked': 'User unlocked', 'user.password_reset': 'Password reset',
  'user.role_changed': 'Role changed', 'user.mfa_enabled': 'MFA enabled',
  'user.mfa_disabled': 'MFA disabled', 'user.login': 'Login',
  'tenant.plan.changed': 'Plan changed', 'tenant.is_active.changed': 'Tenant status changed',
  'tenant.name.changed': 'Tenant renamed', 'tenant.primary_color.changed': 'Brand colour changed',
  'branding.updated': 'Branding updated', 'sla_config.updated': 'SLA config updated',
  'security_config.updated': 'Security config updated',
  'workflow.created': 'Workflow created', 'workflow.updated': 'Workflow updated',
  'workflow.deleted': 'Workflow deleted',
};

function getCategory(action) {
  if (!action) return 'other';
  const prefix = action.split('.')[0];
  return ACTION_CATEGORY[prefix] ? prefix : 'other';
}

function ActionBadge({ action }) {
  const cat = getCategory(action);
  const { color } = ACTION_CATEGORY[cat] || ACTION_CATEGORY.other;
  const label = ACTION_LABELS[action] || action;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>;
}

function DiffValue({ old_value, new_value }) {
  if (!old_value && !new_value) return <span className="text-gray-400">—</span>;
  if (old_value && new_value) {
    return (
      <span className="text-xs">
        <span className="line-through text-red-400 mr-1">{old_value.length > 30 ? old_value.slice(0,30)+'…' : old_value}</span>
        →
        <span className="text-green-600 dark:text-green-400 ml-1">{new_value.length > 30 ? new_value.slice(0,30)+'…' : new_value}</span>
      </span>
    );
  }
  return <span className="text-xs text-gray-500">{(new_value || old_value || '').slice(0,60)}</span>;
}

function ExpandedRow({ log }) {
  return (
    <tr className="bg-gray-50 dark:bg-gray-750">
      <td colSpan={6} className="px-6 py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div><span className="text-gray-400 block mb-1">Actor</span><span className="text-gray-700 dark:text-gray-300 font-medium">{log.actor_name || log.actor_email || '—'}</span></div>
          <div><span className="text-gray-400 block mb-1">IP Address</span><span className="text-gray-700 dark:text-gray-300 font-mono">{log.ip_address || '—'}</span></div>
          <div><span className="text-gray-400 block mb-1">Target</span><span className="text-gray-700 dark:text-gray-300">{log.target_label || log.target_id || '—'} {log.target_type ? `(${log.target_type})` : ''}</span></div>
          <div><span className="text-gray-400 block mb-1">Timestamp</span><span className="text-gray-700 dark:text-gray-300">{log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</span></div>
          {log.old_value && <div className="col-span-2"><span className="text-gray-400 block mb-1">Before</span><pre className="text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded text-xs overflow-auto max-h-24">{log.old_value}</pre></div>}
          {log.new_value && <div className="col-span-2"><span className="text-gray-400 block mb-1">After</span><pre className="text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-2 rounded text-xs overflow-auto max-h-24">{log.new_value}</pre></div>}
        </div>
      </td>
    </tr>
  );
}

// Group logs by date
function groupByDate(logs) {
  return logs.reduce((acc, log) => {
    const day = log.created_at ? new Date(log.created_at).toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : 'Unknown date';
    if (!acc[day]) acc[day] = [];
    acc[day].push(log);
    return acc;
  }, {});
}

export default function AuditLog() {
  const { token } = useAuth();
  const { t } = useTranslation();

  const [logs, setLogs]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(0);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading]   = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [view, setView]         = useState('table'); // table | timeline

  // Filters
  const [search, setSearch]       = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT });
      if (search)         params.set('search', search);
      if (actionFilter)   params.set('action', actionFilter);
      if (categoryFilter) params.set('action', categoryFilter); // uses prefix match on backend
      if (startDate)      params.set('start_date', startDate);
      if (endDate)        params.set('end_date', endDate);
      const data = await apiFetch(`/admin/audit-log?${params}`, token);
      setLogs(data.items || []);
      setTotal(data.total || 0);
      setByCategory(data.by_category || {});
    } catch(err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, [page, search, actionFilter, categoryFilter, startDate, endDate]);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (search)       params.set('search', search);
    if (actionFilter) params.set('action', actionFilter);
    if (startDate)    params.set('start_date', startDate);
    if (endDate)      params.set('end_date', endDate);
    window.open(`${API}/admin/audit-log/export/csv?${params}`, '_blank');
  };

  const grouped = groupByDate(logs);
  const inp = "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">🔍 Audit Log</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track all admin and system actions across your account</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView(v => v === 'table' ? 'timeline' : 'table')}
                    className={inp + " cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition"}>
              {view === 'table' ? '📅 Timeline' : '📋 Table'}
            </button>
            <button onClick={handleExport} className={inp + " cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition"}>
              📄 Export CSV
            </button>
          </div>
        </div>

        <div className="flex gap-5">
          {/* Category sidebar */}
          <div className="w-44 flex-shrink-0 space-y-1">
            <button onClick={() => { setCategoryFilter(''); setPage(0); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between ${!categoryFilter ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              <span>All events</span>
              <span className="text-xs text-gray-400">{total}</span>
            </button>
            {Object.entries(byCategory).sort((a,b) => b[1]-a[1]).map(([cat, count]) => {
              const info = ACTION_CATEGORY[cat] || ACTION_CATEGORY.other;
              return (
                <button key={cat} onClick={() => { setCategoryFilter(cat); setPage(0); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between ${categoryFilter===cat ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  <span>{info.icon} {info.label}</span>
                  <span className="text-xs text-gray-400">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            {/* Filters row */}
            <div className="flex gap-2 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
                       placeholder="Search by actor, action, target..."
                       className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(0); }} className={inp} />
              <span className="text-gray-400 self-center text-sm">to</span>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(0); }} className={inp} />
              {(search || startDate || endDate || categoryFilter) && (
                <button onClick={() => { setSearch(''); setStartDate(''); setEndDate(''); setCategoryFilter(''); setPage(0); }}
                        className="text-sm text-indigo-500 hover:text-indigo-700 px-2">✕ Clear</button>
              )}
            </div>

            {loading ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-10 text-center text-gray-400 text-sm">Loading…</div>
            ) : logs.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-10 text-center">
                <p className="text-4xl mb-3">🔍</p>
                <p className="text-gray-400 text-sm">No audit log entries match your filters.</p>
              </div>
            ) : view === 'timeline' ? (
              /* ── TIMELINE VIEW ── */
              <div className="space-y-6">
                {Object.entries(grouped).map(([day, dayLogs]) => (
                  <div key={day}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                      <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap">{day}</span>
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    </div>
                    <div className="space-y-2 relative ml-4">
                      <div className="absolute left-2 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
                      {dayLogs.map(log => {
                        const cat = getCategory(log.action);
                        const catInfo = ACTION_CATEGORY[cat] || ACTION_CATEGORY.other;
                        const isExpanded = expandedId === log.id;
                        return (
                          <div key={log.id} className="relative pl-8">
                            <div className="absolute left-0 w-5 h-5 rounded-full bg-white dark:bg-gray-800 border-2 border-indigo-300 dark:border-indigo-600 flex items-center justify-center text-xs -ml-0.5 mt-0.5">
                              {catInfo.icon}
                            </div>
                            <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 cursor-pointer hover:shadow-sm transition ${isExpanded ? 'shadow-sm' : ''}`}
                                 onClick={() => setExpandedId(isExpanded ? null : log.id)}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <ActionBadge action={log.action} />
                                    <span className="text-xs text-gray-400">{new Date(log.created_at).toLocaleTimeString()}</span>
                                  </div>
                                  <p className="text-sm text-gray-700 dark:text-gray-300">
                                    <span className="font-medium">{log.actor_name || log.actor_email || 'System'}</span>
                                    {log.target_label && <> → <span className="text-indigo-600 dark:text-indigo-400">{log.target_label}</span></>}
                                    {log.ip_address && <span className="text-xs text-gray-400 ml-2">· {log.ip_address}</span>}
                                  </p>
                                  {(log.old_value || log.new_value) && (
                                    <div className="mt-1.5"><DiffValue old_value={log.old_value} new_value={log.new_value} /></div>
                                  )}
                                </div>
                                <span className="text-gray-300 dark:text-gray-600 text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                              </div>
                              {isExpanded && (
                                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-3 text-xs">
                                  <div><span className="text-gray-400">IP Address</span><p className="font-mono text-gray-700 dark:text-gray-300">{log.ip_address || '—'}</p></div>
                                  <div><span className="text-gray-400">Target</span><p className="text-gray-700 dark:text-gray-300">{log.target_label || log.target_id || '—'} {log.target_type ? `(${log.target_type})` : ''}</p></div>
                                  {log.old_value && <div className="col-span-2"><span className="text-gray-400">Before</span><pre className="mt-1 text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded overflow-auto max-h-20">{log.old_value}</pre></div>}
                                  {log.new_value && <div className="col-span-2"><span className="text-gray-400">After</span><pre className="mt-1 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-2 rounded overflow-auto max-h-20">{log.new_value}</pre></div>}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* ── TABLE VIEW ── */
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
                      <tr>
                        {['When','Action','By','Target','Change','IP'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {logs.map(log => (
                        <>
                          <tr key={log.id}
                              className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition"
                              onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                            <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">
                              {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                            </td>
                            <td className="px-5 py-3"><ActionBadge action={log.action} /></td>
                            <td className="px-5 py-3 text-xs text-gray-700 dark:text-gray-300">
                              <div className="font-medium">{log.actor_name || '—'}</div>
                              <div className="text-gray-400">{log.actor_email || ''}</div>
                            </td>
                            <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-400">
                              {log.target_label || log.target_id || '—'}
                              {log.target_type && <span className="ml-1 text-gray-400">({log.target_type})</span>}
                            </td>
                            <td className="px-5 py-3 max-w-xs"><DiffValue old_value={log.old_value} new_value={log.new_value} /></td>
                            <td className="px-5 py-3 text-xs text-gray-400 font-mono">{log.ip_address || '—'}</td>
                          </tr>
                          {expandedId === log.id && <ExpandedRow key={`exp-${log.id}`} log={log} />}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pagination */}
            {total > LIMIT && (
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()}</span>
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
        </div>
      </div>
    </Layout>
  );
}
