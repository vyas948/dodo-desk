import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { formatId } from '../utils/ticketId';
import Pagination from '../components/Pagination';

const LIMIT = 20;
const RISK_BADGE = {
  low:      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  medium:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  high:     'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  critical: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-200',
};
const STATUS_BADGE = {
  draft:            'bg-gray-100 text-gray-600',
  pending_approval: 'bg-amber-100 text-amber-700',
  in_review:        'bg-blue-100 text-blue-700',
  approved:         'bg-green-100 text-green-700',
  scheduled:        'bg-indigo-100 text-indigo-700',
  in_progress:      'bg-purple-100 text-purple-700',
  implemented:      'bg-teal-100 text-teal-700',
  rejected:         'bg-red-100 text-red-700',
  cancelled:        'bg-gray-200 text-gray-600',
  failed:           'bg-red-200 text-red-900',
};
const TYPE_ICON = { normal: '🔵', standard: '🟢', emergency: '🔴' };
const ALL_STATUSES = ['draft','pending_approval','in_review','approved','scheduled','in_progress','implemented','rejected','cancelled','failed'];

export default function ChangeList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [changes, setChanges]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter]   = useState('');
  const [riskFilter, setRiskFilter]   = useState('');
  const [view, setView]               = useState('list'); // list | calendar

  useEffect(() => {
    if (!token) return;
    const delay = searchTerm ? 300 : 0;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ skip: (page - 1) * LIMIT, limit: LIMIT });
        if (searchTerm.trim()) params.append('search', searchTerm.trim());
        if (statusFilter) params.append('status', statusFilter);
        if (typeFilter) params.append('change_type', typeFilter);
        if (riskFilter) params.append('risk_level', riskFilter);
        const data = await apiFetch(`/changes/?${params}`, token);
        setChanges(data.items ?? []);
        setTotal(data.total ?? 0);
      } catch (err) { toast.error(err.message); }
      finally { setLoading(false); }
    }, delay);
    return () => clearTimeout(timer);
  }, [token, searchTerm, page, statusFilter, typeFilter, riskFilter]);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{t('change.title')}</h2>
          <div className="flex gap-2">
            <button onClick={() => setView(v => v === 'list' ? 'calendar' : 'list')}
                    className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition">
              {view === 'list' ? '📅 Calendar' : '📋 List'}
            </button>
            {user?.role !== 'readonly' && (
              <Link to="/changes/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
                {t('change.newChange')}
              </Link>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
                   placeholder="Search changes..." className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All statuses</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All types</option>
            <option value="normal">🔵 Normal</option>
            <option value="standard">🟢 Standard</option>
            <option value="emergency">🔴 Emergency</option>
          </select>
          <select value={riskFilter} onChange={e => { setRiskFilter(e.target.value); setPage(1); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All risks</option>
            {['low','medium','high','critical'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {view === 'calendar' ? (
          <ChangeCalendar token={token} toast={toast} />
        ) : loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-gray-400">{t('common.loading')}</p>
          </div>
        ) : changes.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-gray-400 text-sm">{searchTerm ? `No changes match "${searchTerm}"` : t('change.noChanges')}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">ID</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Title</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Risk</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Planned</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Requester</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {changes.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-5 py-4 text-sm font-medium">
                        <Link to={`/changes/${c.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline font-mono">{formatId(c.id, 'change')}</Link>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate">{c.title}</td>
                      <td className="px-5 py-4 text-sm">
                        <span>{TYPE_ICON[c.change_type] || '🔵'} <span className="text-gray-600 dark:text-gray-300 capitalize">{c.change_type || 'normal'}</span></span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${RISK_BADGE[c.risk_level] || ''}`}>{c.risk_level}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[c.status] || ''}`}>{c.status?.replace(/_/g,' ')}</span>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{c.planned_date ? new Date(c.planned_date).toLocaleDateString() : '—'}</td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{c.requester_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700 px-5">
              <Pagination total={total} page={page} limit={LIMIT} onPageChange={p => setPage(p)} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function ChangeCalendar({ token, toast }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    apiFetch('/changes/calendar', token).then(d => setItems(Array.isArray(d) ? d : [])).catch(e => toast.error(e.message));
  }, [token]);

  const TYPE_COLOR = { normal: '#6366f1', standard: '#22c55e', emergency: '#ef4444' };
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  const getChangesForDay = (day) => {
    const d = new Date(year, month, day);
    return items.filter(c => {
      const pd = c.planned_date ? new Date(c.planned_date) : null;
      const sd = c.start_date ? new Date(c.start_date) : null;
      return (pd && pd.toDateString() === d.toDateString()) || (sd && sd.toDateString() === d.toDateString());
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
      <h3 className="font-semibold text-gray-800 dark:text-white mb-4">{monthName}</h3>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({length: firstDay}).map((_,i) => <div key={`e${i}`} />)}
        {Array.from({length: daysInMonth}).map((_,i) => {
          const day = i + 1;
          const dayChanges = getChangesForDay(day);
          const isToday = day === now.getDate();
          return (
            <div key={day} className={`min-h-[60px] rounded-lg p-1 ${isToday ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-300 dark:border-indigo-600' : 'border border-gray-100 dark:border-gray-700'}`}>
              <p className={`text-xs font-medium mb-1 ${isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'}`}>{day}</p>
              {dayChanges.map(c => (
                <Link key={c.id} to={`/changes/${c.id}`}
                      className="block text-xs truncate rounded px-1 py-0.5 mb-0.5 text-white hover:opacity-80 transition"
                      style={{backgroundColor: TYPE_COLOR[c.change_type] || '#6366f1'}}>
                  {c.title}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        {Object.entries(TYPE_COLOR).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-sm" style={{backgroundColor: color}} /> {type}
          </span>
        ))}
      </div>
    </div>
  );
}
