import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import { formatId } from '../utils/ticketId';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from 'recharts';

const LIMIT = 20;

const PRIORITY_CLASSES = {
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  medium: 'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high: 'bg-orange-50 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  critical: 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const SLA_CLASSES = {
  ok: 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300',
  warning: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  overdue: 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const FILTERS = [
  { key: 'all',        label: 'dashboard.allTickets',    params: {} },
  { key: 'open',       label: 'dashboard.open',          params: { status: 'open' } },
  { key: 'mine',       label: 'dashboard.myOpenTickets', params: { status: 'open' } },
  { key: 'unassigned', label: 'dashboard.unassigned',    params: { assigned: 'unassigned' } },
  { key: 'overdue',    label: 'dashboard.overdue',       params: { status: 'overdue' } },
  { key: 'resolved',   label: 'dashboard.resolved',      params: { status: 'resolved' } },
  { key: 'critical',   label: 'dashboard.critical',      params: { priority: 'critical' } },
  { key: 'in_progress', label: 'dashboard.inProgress',   params: { status: 'in_progress' } },
];

const PIE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];
const PRIORITY_COLORS = { low: '#22c55e', medium: '#6366f1', high: '#f59e0b', critical: '#ef4444' };

export default function Dashboard() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expiringCount, setExpiringCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState(() => {
    const f = searchParams.get('filter');
    return FILTERS.find(x => x.key === f) ? f : 'all';
  });

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [agentList, setAgentList] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterType, setFilterType] = useState('');
  const [sortBy, setSortBy] = useState('');

  // Separate accurate counts — not affected by current filter/page
  const [summaryStats, setSummaryStats] = useState({ open: 0, resolvedToday: 0, overdue: 0 });

  // Chart data — only for agents/admins
  const [byStatus, setByStatus] = useState([]);
  const [byPriority, setByPriority] = useState([]);
  const [daily, setDaily] = useState([]);
  const [chartsLoading, setChartsLoading] = useState(true);

  const isAgentOrAdmin = user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin');

  // Dark mode detection for recharts
  const darkMode = document.documentElement.classList.contains('dark');
  const chartTextColor = darkMode ? '#9ca3af' : '#6b7280';
  const chartGridColor = darkMode ? '#374151' : '#e5e7eb';
  const tooltipStyle = darkMode
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#e5e7eb' }
    : { backgroundColor: '#fff', border: '1px solid #e5e7eb', color: '#111827' };

  const fetchTickets = async (filter = 'all', search = '', p = 1) => {
    setLoading(true);
    try {
      const filterDef = FILTERS.find(f => f.key === filter) || FILTERS[0];
      const params = new URLSearchParams(filterDef.params);
      if (search) params.append('search', search);
      if (filterPriority) params.append('priority', filterPriority);
      if (filterCategory) params.append('category', filterCategory);
      if (filterType) params.append('ticket_type', filterType);
      if (sortBy) params.append('sort_by', sortBy);
      params.append('skip', (p - 1) * LIMIT);
      params.append('limit', LIMIT);
      const data = await apiFetch(`/tickets/?${params}`, token);
      setTickets(data.items ?? []);
      setTotal(data.total ?? 0);
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCharts = async () => {
    if (!isAgentOrAdmin || !token) return;  // guard — don't run without token
    setChartsLoading(true);
    try {
      const [statusData, priorityData, dailyData] = await Promise.all([
        apiFetch('/reports/tickets-by-status', token),
        apiFetch('/reports/tickets-by-priority', token),
        apiFetch('/reports/tickets-created-daily', token),
      ]);
      setByStatus(Array.isArray(statusData) ? statusData : []);
      setByPriority(Array.isArray(priorityData) ? priorityData : []);
      // Last 14 days only
      setDaily(Array.isArray(dailyData) ? dailyData.slice(-14) : []);
    } catch {
      // Charts are non-critical — fail silently
    } finally {
      setChartsLoading(false);
    }
  };

  useEffect(() => {
    const delay = searchTerm ? 300 : 0;
    const timer = setTimeout(() => fetchTickets(activeFilter, searchTerm, page), delay);
    return () => clearTimeout(timer);
  }, [token, activeFilter, searchTerm, page, filterPriority, filterCategory, filterType, sortBy]);

  useEffect(() => {
    // Fetch accurate global counts once on mount
    const fetchSummary = async () => {
      try {
        if (isAgentOrAdmin) {
          const reportData = await apiFetch('/reports/summary', token);
          setSummaryStats({
            open: reportData.open ?? 0,
            resolvedToday: reportData.resolved_today ?? 0,
            overdue: reportData.overdue ?? 0,
          });
        } else {
          const [openData, overdueData] = await Promise.all([
            apiFetch('/tickets/?status=open&limit=1', token),
            apiFetch('/tickets/?status=overdue&limit=1', token),
          ]);
          setSummaryStats({
            open: openData.total ?? 0,
            resolvedToday: 0,
            overdue: overdueData.total ?? 0,
          });
        }
      } catch {}
    };
    fetchSummary();
    if (isAgentOrAdmin) {
      apiFetch('/assets/expiring?days=30', token)
        .then(data => setExpiringCount(Array.isArray(data) ? data.length : 0))
        .catch(() => {});
    }
    fetchCharts();

    // Fetch agents for bulk assign dropdown (agents/admins only)
    if (isAgentOrAdmin) {
      apiFetch('/users/', token)
        .then(data => {
          const users = Array.isArray(data) ? data : (data.items ?? []);
          setAgentList(users.filter(u => u.role === 'agent' || u.role === 'admin'));
        })
        .catch(() => {});
    }
  }, [token, user]);

  const handlePageChange = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const statCardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const chartCardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const clickableStatClass = `${statCardClass} cursor-pointer hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-all select-none`;
  const filterActiveClass = "px-4 py-2 rounded-lg text-sm font-medium transition bg-indigo-600 text-white shadow-sm";
  const filterInactiveClass = "px-4 py-2 rounded-lg text-sm font-medium transition bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700";

  const handleStatClick = (filterKey) => {
    setActiveFilter(filterKey);
    setSearchTerm('');
    setPage(1);
    setSelectedIds(new Set());
    setTimeout(() => document.getElementById('ticket-list')?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === tickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tickets.map(t => t.id)));
    }
  };

  const handleBulkApply = async () => {
    if (!bulkAction || !bulkValue || selectedIds.size === 0) {
      toast.error('Please select tickets, an action and a value.');
      return;
    }
    setBulkLoading(true);
    try {
      const res = await apiFetch('/tickets/bulk-update', token, {
        method: 'POST',
        body: JSON.stringify({
          ticket_ids: Array.from(selectedIds),
          action: bulkAction,
          value: bulkValue,
        }),
      });
      toast.success(`${res.updated} ticket(s) updated.`);
      setSelectedIds(new Set());
      setBulkAction('');
      setBulkValue('');
      fetchTickets(activeFilter, searchTerm, page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <Layout>
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
        <div className={clickableStatClass} onClick={() => handleStatClick(isAgentOrAdmin ? 'open' : 'mine')} title={isAgentOrAdmin ? "Show open & in-progress tickets" : "Show my open tickets"}>
          <p className="text-sm text-gray-500 dark:text-gray-400">{isAgentOrAdmin ? t('dashboard.open') : t('dashboard.myOpenTickets')}</p>
          <p className="text-3xl font-bold text-blue-700 dark:text-blue-400">{summaryStats.open}</p>
          <p className="text-xs text-blue-400 dark:text-blue-500 mt-1">Click to view →</p>
        </div>
        <div className={clickableStatClass} onClick={() => handleStatClick('resolved')} title="Show resolved tickets">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.resolvedToday')}</p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">{summaryStats.resolvedToday}</p>
          <p className="text-xs text-green-400 dark:text-green-500 mt-1">Click to view →</p>
        </div>
        <div className={clickableStatClass} onClick={() => handleStatClick('overdue')} title="Show overdue tickets">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.overdue')}</p>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400">{summaryStats.overdue}</p>
          <p className="text-xs text-red-400 dark:text-red-500 mt-1">Click to view →</p>
        </div>
        {isAgentOrAdmin && expiringCount > 0 && (
          <Link to="/assets" className={`${statCardClass} hover:shadow-md hover:border-yellow-200 dark:hover:border-yellow-700 transition-all`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.expiringLicenses')}</p>
            <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-400">{expiringCount}</p>
            <p className="text-xs text-yellow-400 dark:text-yellow-500 mt-1">Click to view →</p>
          </Link>
        )}
      </div>

      {/* Charts — agents/admins only */}
      {isAgentOrAdmin && !chartsLoading && (byStatus.length > 0 || byPriority.length > 0 || daily.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">

          {/* Tickets by status — donut */}
          {byStatus.length > 0 && (
            <div className={chartCardClass}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('reports.ticketsByStatus')}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Click a slice to filter</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byStatus} dataKey="count" nameKey="status"
                       cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                       cursor="pointer"
                       onClick={(data) => {
                         if (data?.status) {
                           const key = data.status === 'open' ? 'open' : data.status === 'overdue' ? 'overdue' : data.status === 'resolved' ? 'resolved' : 'all';
                           setFilterPriority(''); setFilterCategory(''); setFilterType('');
                           handleStatClick(key);
                         }
                       }}>
                    {byStatus.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: chartTextColor, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tickets by priority — bar */}
          {byPriority.length > 0 && (
            <div className={chartCardClass}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('reports.ticketsByPriority')}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Click a bar to filter</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byPriority} barSize={32}
                          onClick={(data) => {
                            if (data?.activePayload?.[0]?.payload?.priority) {
                              const p = data.activePayload[0].payload.priority;
                              setFilterPriority(p);
                              setFilterCategory(''); setFilterType(''); setSortBy('');
                              setActiveFilter('all'); setPage(1); setSearchTerm('');
                              setTimeout(() => document.getElementById('ticket-list')?.scrollIntoView({ behavior: 'smooth' }), 100);
                            }
                          }}
                          style={{ cursor: 'pointer' }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="priority" tick={{ fill: chartTextColor, fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fill: chartTextColor, fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {byPriority.map((entry, i) => (
                      <Cell key={i} fill={PRIORITY_COLORS[entry.priority] || '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Daily trend — line */}
          {daily.length > 0 && (
            <div className={chartCardClass}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('reports.ticketsCreated')} (14d)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="date" tick={{ fill: chartTextColor, fontSize: 10 }}
                         tickFormatter={d => d.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fill: chartTextColor, fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="count" stroke="#6366f1"
                        strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.filter(f => {
          if (f.key === 'mine' && isAgentOrAdmin) return false;
          if (f.key === 'open' && !isAgentOrAdmin) return false;
          // These are only triggered by clicking charts/cards, not shown as tabs
          if (['resolved', 'critical', 'in_progress'].includes(f.key)) return false;
          return true;
        }).map(f => (
          <button key={f.key} onClick={() => { setActiveFilter(f.key); setSearchTerm(''); setPage(1); setFilterPriority(''); setFilterCategory(''); setFilterType(''); setSortBy(''); }}
                  className={activeFilter === f.key ? filterActiveClass : filterInactiveClass}>
            {t(f.label)}
          </button>
        ))}
        {/* Show chip when a chart/card filter is active */}
        {['resolved', 'critical', 'in_progress'].includes(activeFilter) && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
            {activeFilter === 'resolved' && '✅ Resolved'}
            {activeFilter === 'critical' && '🔴 Critical priority'}
            {activeFilter === 'in_progress' && '⚙ In Progress'}
            <button onClick={() => { setActiveFilter('all'); setPage(1); }} className="ml-1 hover:text-indigo-900 dark:hover:text-white font-bold">×</button>
          </span>
        )}
      </div>

      {/* Search + create buttons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div className="relative w-full sm:w-96">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder={t('common.search') + '...'} value={searchTerm}
                 onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
                 className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500" />
        </div>

        {/* Advanced filters */}
        <div className="flex flex-wrap gap-2">
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            <option value="">{t('ticket.allTypes') || 'All types'}</option>
            <option value="incident">{t('ticket.incident') || 'Incidents'}</option>
            <option value="service_request">{t('ticket.serviceRequest') || 'Service Requests'}</option>
          </select>
          <select value={filterPriority} onChange={e => { setFilterPriority(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            <option value="">{t('ticket.allPriorities') || 'All priorities'}</option>
            <option value="critical">{t('ticket.critical') || 'Critical'}</option>
            <option value="high">{t('ticket.high') || 'High'}</option>
            <option value="medium">{t('ticket.medium') || 'Medium'}</option>
            <option value="low">{t('ticket.low') || 'Low'}</option>
          </select>
          <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            <option value="">{t('ticket.allCategories') || 'All categories'}</option>
            {['Hardware','Software','Network','Account','Email','Security','Printer','Mobile Device','Cloud Services','Telephony','Other'].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            <option value="">{t('ticket.sortNewest') || 'Sort: Newest first'}</option>
            <option value="priority">{t('ticket.sortPriority') || 'Sort: Priority'}</option>
            <option value="sla">{t('ticket.sortSla') || 'Sort: SLA deadline'}</option>
          </select>
          {(filterType || filterPriority || filterCategory || sortBy) && (
            <button onClick={() => { setFilterType(''); setFilterPriority(''); setFilterCategory(''); setSortBy(''); setPage(1); }}
                    className="text-sm text-red-500 hover:text-red-700 px-2 py-2">
              × Clear filters
            </button>
          )}
        </div>

        {user?.role === 'employee' && (
          <div className="flex gap-2">
            <Link to="/create-ticket?type=incident" className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition">{t('dashboard.reportIncident')}</Link>
            <Link to="/create-ticket?type=service_request" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 transition">{t('dashboard.serviceRequest')}</Link>
          </div>
        )}
      </div>

      {/* Ticket list */}
      <div id="ticket-list" className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>
            {activeFilter === 'all' ? t('dashboard.recentTickets') : t(FILTERS.find(f => f.key === activeFilter)?.label || 'dashboard.recentTickets')} ({total})
          </h2>
          {/* Bulk action toolbar — agents/admins only, shown when tickets are selected */}
          {isAgentOrAdmin && selectedIds.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">{selectedIds.size} selected</span>
              <select value={bulkAction} onChange={e => { setBulkAction(e.target.value); setBulkValue(''); }}
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Action...</option>
                <option value="assign">Assign to</option>
                <option value="status">Change status</option>
                <option value="priority">Change priority</option>
              </select>
              {bulkAction === 'assign' && (
                <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  <option value="">Select agent...</option>
                  {['admin', 'agent'].map(role => {
                    const group = agentList.filter(a => a.role === role);
                    if (!group.length) return null;
                    return (
                      <optgroup key={role} label={role === 'admin' ? 'Admins' : 'Agents'}>
                        {group.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
              )}
              {bulkAction === 'status' && (
                <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  <option value="">Select status...</option>
                  <option value="open">{t('ticket.open')}</option>
                  <option value="in_progress">{t('ticket.in_progress')}</option>
                  <option value="resolved">{t('ticket.resolved')}</option>
                  <option value="closed">{t('ticket.closed')}</option>
                </select>
              )}
              {bulkAction === 'priority' && (
                <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  <option value="">Select priority...</option>
                  <option value="low">{t('ticket.low')}</option>
                  <option value="medium">{t('ticket.medium')}</option>
                  <option value="high">{t('ticket.high')}</option>
                  <option value="critical">{t('ticket.critical')}</option>
                </select>
              )}
              <button onClick={handleBulkApply} disabled={bulkLoading || !bulkAction || !bulkValue}
                      className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition">
                {bulkLoading ? 'Applying...' : 'Apply'}
              </button>
              <button onClick={() => setSelectedIds(new Set())}
                      className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                Clear
              </button>
            </div>
          )}
        </div>
        {loading ? (
          <div className="p-10 text-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div>
        ) : tickets.length === 0 ? (
          <div className="p-10 text-center text-gray-400 dark:text-gray-500">{t('dashboard.noTickets')}</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {/* Select all row — agents/admins only */}
            {isAgentOrAdmin && tickets.length > 0 && (
              <li className="px-5 py-2 bg-gray-50 dark:bg-gray-700/50 flex items-center gap-3">
                <input type="checkbox"
                       checked={selectedIds.size === tickets.length && tickets.length > 0}
                       onChange={toggleSelectAll}
                       className="w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedIds.size === tickets.length ? 'Deselect all' : 'Select all on this page'}
                </span>
              </li>
            )}
            {tickets.map(ticket => (
              <li key={ticket.id} className={`p-5 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between ${selectedIds.has(ticket.id) ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                <div className="flex items-center gap-3">
                  {/* Checkbox — agents/admins only */}
                  {isAgentOrAdmin && (
                    <input type="checkbox"
                           checked={selectedIds.has(ticket.id)}
                           onChange={() => toggleSelect(ticket.id)}
                           onClick={e => e.stopPropagation()}
                           className="w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer flex-shrink-0" />
                  )}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ticket.sla_status === 'overdue' ? 'bg-red-500' : ticket.sla_status === 'warning' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <div>
                    <Link to={`/tickets/${ticket.id}`} className="font-medium text-gray-800 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400">
                      {formatId(ticket.id, ticket.ticket_type)} – {ticket.title}
                    </Link>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {ticket.requester_name} · {new Date(ticket.created_at).toLocaleDateString()} · {ticket.category || t('common.general')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${ticket.ticket_type === 'incident' ? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300'}`}>
                    {ticket.ticket_type === 'incident' ? t('ticket.incident') : t('ticket.serviceRequest')}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${PRIORITY_CLASSES[ticket.priority]}`}>{t(`ticket.${ticket.priority}`)}</span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${SLA_CLASSES[ticket.sla_status]}`}>
                    {ticket.sla_status === 'overdue' ? t('dashboard.overdue') : t(`ticket.${ticket.sla_status}`)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-gray-100 dark:border-gray-700 px-6 py-2">
          <Pagination total={total} page={page} limit={LIMIT} onPageChange={handlePageChange} />
        </div>
      </div>
    </Layout>
  );
}
