import { useEffect, useState, useCallback, useRef } from 'react';
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
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';

const LIMIT = 20;
const AUTO_REFRESH_MS = 60000;

const PRIORITY_CLASSES = {
  low:      'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  medium:   'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high:     'bg-orange-50 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  critical: 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300',
};
const STATUS_CLASSES = {
  open:             'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  in_progress:      'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  pending_approval: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  resolved:         'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  closed:           'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};
const PIE_COLORS      = ['#6366f1','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
const PRIORITY_COLORS = { low:'#22c55e', medium:'#6366f1', high:'#f59e0b', critical:'#ef4444' };

function slaCountdown(deadline) {
  if (!deadline) return null;
  const diff = new Date(deadline) - new Date();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h/24)}d ${h%24}h`;
  if (h > 0)   return `${h}h ${m}m`;
  return `${m}m`;
}

const AVAILABILITY_DOT = {
  online:  'bg-green-400',
  busy:    'bg-yellow-400',
  away:    'bg-orange-400',
  offline: 'bg-gray-400',
};
const AVAILABILITY_LABEL = { online: 'Online', busy: 'Busy', away: 'Away', offline: 'Offline' };

function Avatar({ name, availability }) {
  if (!name) return null;
  const initials = name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
  const colors = ['bg-indigo-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-violet-500','bg-cyan-500'];
  const color  = colors[name.charCodeAt(0) % colors.length];
  const title  = availability ? `${name} · ${AVAILABILITY_LABEL[availability] || ''}` : name;
  return (
    <div className="relative flex-shrink-0" title={title}>
      <div className={`w-6 h-6 ${color} rounded-full flex items-center justify-center text-white text-xs font-semibold`}>
        {initials}
      </div>
      {availability && (
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 ${AVAILABILITY_DOT[availability] || AVAILABILITY_DOT.offline}`} />
      )}
    </div>
  );
}

// Active filter pill shown above list when a chart/card filter is active
function ActiveFilterPill({ label, onClear }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg text-sm text-indigo-700 dark:text-indigo-300 w-fit mb-3">
      <span>Showing: <strong>{label}</strong></span>
      <button onClick={onClear} className="ml-1 text-indigo-400 hover:text-indigo-600 font-bold">×</button>
    </div>
  );
}

function TeamAvailability({ token }) {
  const [team, setTeam]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchTeam = () => {
    apiFetch('/users/availability', token)
      .then(d => setTeam(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTeam();
    const interval = setInterval(fetchTeam, 60000); // refresh every 60s alongside dashboard
    return () => clearInterval(interval);
  }, [token]);

  if (loading) return null;
  if (team.length === 0) return null;

  const onlineCount = team.filter(u => u.availability === 'online').length;
  const visibleTeam = expanded ? team : team.slice(0, 6);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">🟢 Team Availability</h3>
        <span className="text-xs text-gray-400">{onlineCount}/{team.length} online</span>
      </div>
      <div className="space-y-2">
        {visibleTeam.map(u => (
          <div key={u.id} className="flex items-center gap-2.5">
            <div className="relative flex-shrink-0">
              <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold overflow-hidden">
                {u.profile_photo
                  ? <img src={u.profile_photo} alt="" className="w-full h-full object-cover" />
                  : u.full_name?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 ${AVAILABILITY_DOT[u.availability] || AVAILABILITY_DOT.offline}`} />
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">{u.full_name}</span>
            <span className="text-xs text-gray-400">{AVAILABILITY_LABEL[u.availability]}</span>
          </div>
        ))}
      </div>
      {team.length > 6 && (
        <button onClick={() => setExpanded(e => !e)} className="text-xs text-indigo-500 hover:text-indigo-700 mt-2">
          {expanded ? 'Show less' : `Show ${team.length - 6} more`}
        </button>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  // Ticket list
  const [tickets, setTickets]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Active filters — each has a label for the pill and params for the API
  const [activeFilter, setActiveFilter] = useState({ key: 'all', label: '', params: {} });

  // Secondary filters
  const [filterType, setFilterType]         = useState('');
  const [filterGroup, setFilterGroup]       = useState('');
  const [sortBy, setSortBy]                 = useState('');
  const [density, setDensity]               = useState(() => localStorage.getItem('dashDensity') || 'comfortable');

  // Bulk
  const [selectedIds, setSelectedIds]   = useState(new Set());
  const [bulkAction, setBulkAction]     = useState('');
  const [bulkValue, setBulkValue]       = useState('');
  const [bulkLoading, setBulkLoading]   = useState(false);

  // Data
  const [agentList, setAgentList]   = useState([]);
  const [groupList, setGroupList]   = useState([]);
  const [savedViews, setSavedViews] = useState([]);
  const [showSaveView, setShowSaveView] = useState(false);
  const [newViewName, setNewViewName]   = useState('');
  const [newViewShared, setNewViewShared] = useState(false);

  // KPIs + charts
  const [summaryStats, setSummaryStats] = useState({ open: 0, resolvedToday: 0, overdue: 0, openChanges: 0 });
  const [myStats, setMyStats]           = useState(null);
  const [expiringCount, setExpiringCount] = useState(0);
  const [byStatus, setByStatus]         = useState([]);
  const [byPriority, setByPriority]     = useState([]);
  const [daily, setDaily]               = useState([]);
  const [chartsLoading, setChartsLoading] = useState(true);

  // Auto-refresh
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [refreshing, setRefreshing]   = useState(false);
  const refreshTimer = useRef(null);

  const darkMode       = document.documentElement.classList.contains('dark');
  const chartTextColor = darkMode ? '#9ca3af' : '#6b7280';
  const chartGridColor = darkMode ? '#374151' : '#e5e7eb';
  const tooltipStyle   = darkMode
    ? { backgroundColor:'#1f2937', border:'1px solid #374151', color:'#e5e7eb' }
    : { backgroundColor:'#fff', border:'1px solid #e5e7eb', color:'#111827' };

  // ── Fetch tickets ──────────────────────────────────────────────────────
  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const params = new URLSearchParams();
      // Apply active filter params
      Object.entries(activeFilter.params).forEach(([k,v]) => params.append(k, v));
      if (searchTerm)  params.append('search', searchTerm);
      if (filterType)  params.append('ticket_type', filterType);
      if (filterGroup) params.append('group_id', filterGroup);
      if (sortBy)      params.append('sort_by', sortBy);
      params.append('skip', (page - 1) * LIMIT);
      params.append('limit', LIMIT);
      const data = await apiFetch(`/tickets/?${params}`, token);
      setTickets(data.items ?? []);
      setTotal(data.total ?? 0);
      if (!silent) setSelectedIds(new Set());
      setLastRefresh(new Date());
    } catch(err) { if (!silent) toast.error(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, activeFilter, searchTerm, page, filterType, filterGroup, sortBy]);

  // ── Fetch summary + charts ─────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    try {
      const [rep, ms] = await Promise.all([
        apiFetch('/reports/summary', token),
        isAgentOrAdmin ? apiFetch('/reports/my-stats', token) : Promise.resolve(null),
      ]);
      setSummaryStats({ open: rep.open??0, resolvedToday: rep.resolved_today??0, overdue: rep.overdue??0, openChanges: rep.open_changes??0 });
      if (ms) setMyStats(ms);
    } catch {}
  }, [token, isAgentOrAdmin]);

  const fetchCharts = useCallback(async () => {
    if (!isAgentOrAdmin) return;
    setChartsLoading(true);
    try {
      const [s, p, d] = await Promise.all([
        apiFetch('/reports/tickets-by-status', token),
        apiFetch('/reports/tickets-by-priority', token),
        apiFetch('/reports/tickets-created-daily', token),
      ]);
      setByStatus(Array.isArray(s) ? s : []);
      setByPriority(Array.isArray(p) ? p : []);
      setDaily(Array.isArray(d) ? d.slice(-14) : []);
    } catch {}
    finally { setChartsLoading(false); }
  }, [isAgentOrAdmin, token]);

  // ── Set a filter and scroll to list ────────────────────────────────────
  const applyFilter = useCallback((key, label, params) => {
    setActiveFilter({ key, label, params });
    setSearchTerm('');
    setPage(1);
    setSelectedIds(new Set());
    setTimeout(() => {
      document.getElementById('ticket-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  const clearFilter = () => {
    setActiveFilter({ key: 'all', label: '', params: {} });
    setSearchTerm('');
    setPage(1);
  };

  // ── Initial load ───────────────────────────────────────────────────────
  useEffect(() => {
    fetchSummary();
    fetchCharts();
    if (isAgentOrAdmin) {
      apiFetch('/assets/expiring?days=30', token).then(d => setExpiringCount(Array.isArray(d)?d.length:0)).catch(()=>{});
      apiFetch('/users/', token).then(d => { const u=Array.isArray(d)?d:(d.items??[]); setAgentList(u.filter(x=>['agent','admin','super_admin'].includes(x.role))); }).catch(()=>{});
      apiFetch('/groups/', token).then(d => setGroupList(Array.isArray(d)?d:[])).catch(()=>{});
      apiFetch('/ticket-views/', token).then(d => setSavedViews(Array.isArray(d)?d:[])).catch(()=>{});
    }
  }, [token]);

  // Re-fetch tickets when filter/search/page changes
  useEffect(() => {
    const delay = searchTerm ? 300 : 0;
    const timer = setTimeout(() => fetchTickets(), delay);
    return () => clearTimeout(timer);
  }, [activeFilter, searchTerm, page, filterType, filterGroup, sortBy, token]);

  // Auto-refresh
  useEffect(() => {
    refreshTimer.current = setInterval(() => { fetchTickets(true); fetchSummary(); }, AUTO_REFRESH_MS);
    return () => clearInterval(refreshTimer.current);
  }, [fetchTickets, fetchSummary]);

  // Chatbot event
  useEffect(() => {
    const h = () => { fetchTickets(); fetchCharts(); };
    window.addEventListener('dodesk:ticket-created', h);
    return () => window.removeEventListener('dodesk:ticket-created', h);
  }, [fetchTickets, fetchCharts]);

  // Bulk
  const toggleSelect    = (id) => setSelectedIds(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const toggleSelectAll = () => setSelectedIds(selectedIds.size===tickets.length?new Set():new Set(tickets.map(t=>t.id)));

  const handleBulkApply = async () => {
    if (!bulkAction||!bulkValue||selectedIds.size===0) { toast.error('Select tickets, action and value'); return; }
    setBulkLoading(true);
    try {
      const res = await apiFetch('/tickets/bulk-update', token, { method:'POST', body:JSON.stringify({ ticket_ids:[...selectedIds], action:bulkAction, value:bulkValue }) });
      toast.success(`${res.updated} ticket(s) updated`);
      setSelectedIds(new Set()); setBulkAction(''); setBulkValue('');
      fetchTickets();
    } catch(err) { toast.error(err.message); }
    finally { setBulkLoading(false); }
  };

  const saveDensity = (d) => { setDensity(d); localStorage.setItem('dashDensity', d); };
  const rowPad = density==='compact' ? 'px-5 py-2.5' : 'px-5 py-4';

  return (
    <Layout>
      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
        {/* Open tickets */}
        <div onClick={() => applyFilter('open', 'Open Tickets', { status:'open' })}
             className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 cursor-pointer hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all select-none">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Open Tickets</p>
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{summaryStats.open}</p>
          <p className="text-xs text-blue-400 mt-1">Click to view →</p>
        </div>
        {/* Resolved today */}
        <div onClick={() => applyFilter('resolved_today', 'Resolved Today', { status:'resolved', updated_after: (() => { const d=new Date(); d.setHours(0,0,0,0); return d.toISOString(); })() })}
             className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 cursor-pointer hover:shadow-md hover:border-green-300 dark:hover:border-green-600 transition-all select-none">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Resolved Today</p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">{summaryStats.resolvedToday}</p>
          <p className="text-xs text-green-400 mt-1">Click to view →</p>
        </div>
        {/* Overdue */}
        <div onClick={() => applyFilter('overdue', 'Overdue Tickets', { status:'overdue' })}
             className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 cursor-pointer hover:shadow-md hover:border-red-300 dark:hover:border-red-600 transition-all select-none">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Overdue</p>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400">{summaryStats.overdue}</p>
          <p className="text-xs text-red-400 mt-1">Click to view →</p>
        </div>
        {isAgentOrAdmin && (
          <Link to="/changes"
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md hover:border-purple-300 dark:hover:border-purple-600 transition-all">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Open Changes</p>
            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{summaryStats.openChanges}</p>
            <p className="text-xs text-purple-400 mt-1">Click to view →</p>
          </Link>
        )}
        {isAgentOrAdmin && expiringCount > 0 && (
          <Link to="/assets"
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md hover:border-yellow-300 dark:hover:border-yellow-600 transition-all">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Expiring Warranty/License</p>
            <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{expiringCount}</p>
            <p className="text-xs text-yellow-400 mt-1">Click to view →</p>
          </Link>
        )}
      </div>

      {/* ── My Work + Team Availability ── */}
      {isAgentOrAdmin && (myStats || true) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
          {myStats && (
            <div className="lg:col-span-2 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">👤 My Work</h3>
                <span className="text-xs text-indigo-400">Assigned to me</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label:'Assigned Open',      value: myStats.assigned_open,    color:'text-indigo-700 dark:text-indigo-300', params:{ assigned:'me', status:'open' },                                                                                      filterLabel:'My Open Tickets' },
                  { label:'Due Today',          value: myStats.due_today,        color:'text-amber-700 dark:text-amber-300',   params:{ assigned:'me', status:'open', due_date_from: (() => { const d=new Date(); d.setHours(0,0,0,0); return d.toISOString(); })(), due_date_to: (() => { const d=new Date(); d.setHours(23,59,59,999); return d.toISOString(); })() },  filterLabel:'My Tickets Due Today' },
                  { label:'Overdue (Mine)',     value: myStats.overdue_mine,     color:'text-red-700 dark:text-red-300',       params:{ assigned:'me', status:'overdue' },                                                                                           filterLabel:'My Overdue Tickets' },
                  { label:'Resolved This Week', value: myStats.resolved_week,    color:'text-green-700 dark:text-green-300',   params:{ assigned:'me', status:'resolved', resolved_after: (() => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); d.setHours(0,0,0,0); return d.toISOString(); })() }, filterLabel:'My Resolved This Week' },
                  { label:'Avg Resolution',     value: myStats.avg_resolution_hours ? `${myStats.avg_resolution_hours}h` : '—', color:'text-gray-700 dark:text-gray-300', params: null, filterLabel: null },
                ].map(({ label, value, color, params, filterLabel }) => (
                  <div key={label}
                       onClick={() => params && applyFilter(`my_${label}`, filterLabel, params)}
                       className={`text-center rounded-lg p-2 transition ${params ? 'cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/40' : ''}`}>
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <TeamAvailability token={token} />
        </div>
      )}

      {/* ── Charts ── */}
      {isAgentOrAdmin && !chartsLoading && (byStatus.length>0 || byPriority.length>0 || daily.length>0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {byStatus.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">By Status</h3>
              <p className="text-xs text-gray-400 mb-3">Click a slice to list those tickets</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%"
                       innerRadius={50} outerRadius={80} cursor="pointer"
                       onClick={d => {
                         if (d?.status) applyFilter(`status_${d.status}`, `Status: ${d.status}`, { status: d.status });
                       }}>
                    {byStatus.map((_,i) => <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color:chartTextColor, fontSize:12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {byPriority.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">By Priority</h3>
              <p className="text-xs text-gray-400 mb-3">Click a bar to list those tickets</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byPriority} barSize={32} style={{cursor:'pointer'}}
                          onClick={d => {
                            const p = d?.activePayload?.[0]?.payload?.priority;
                            if (p) applyFilter(`priority_${p}`, `Priority: ${p}`, { priority: p });
                          }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="priority" tick={{fill:chartTextColor, fontSize:12}} />
                  <YAxis allowDecimals={false} tick={{fill:chartTextColor, fontSize:12}} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[4,4,0,0]}>
                    {byPriority.map((e,i) => <Cell key={i} fill={PRIORITY_COLORS[e.priority]||'#6366f1'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {daily.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Created (14 days)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="date" tick={{fill:chartTextColor, fontSize:10}} tickFormatter={d=>d.slice(5)} />
                  <YAxis allowDecimals={false} tick={{fill:chartTextColor, fontSize:12}} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── Saved views ── */}
      {isAgentOrAdmin && (savedViews.length>0 || showSaveView) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs text-gray-400 font-medium">📌 Views:</span>
          {savedViews.map(v => (
            <button key={v.id}
                    onClick={() => applyFilter(`view_${v.id}`, v.name, v.filters || {})}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 transition flex items-center gap-1">
              {v.is_shared ? '👥' : '👤'} {v.name}
              {v.is_mine && (
                <span onClick={async e => { e.stopPropagation(); await apiFetch(`/ticket-views/${v.id}`,token,{method:'DELETE'}); setSavedViews(sv=>sv.filter(x=>x.id!==v.id)); }} className="ml-1 text-gray-300 hover:text-red-400">✕</span>
              )}
            </button>
          ))}
          {showSaveView ? (
            <div className="flex items-center gap-1.5">
              <input value={newViewName} onChange={e=>setNewViewName(e.target.value)} placeholder="View name..." autoFocus
                     className="border border-indigo-400 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-800 dark:text-white w-36 focus:outline-none" />
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={newViewShared} onChange={e=>setNewViewShared(e.target.checked)} className="rounded" /> Shared
              </label>
              <button onClick={async()=>{ if(!newViewName.trim()) return; const f={...activeFilter.params}; await apiFetch('/ticket-views/',token,{method:'POST',body:JSON.stringify({name:newViewName,filters:f,is_shared:newViewShared})}); const views=await apiFetch('/ticket-views/',token); setSavedViews(Array.isArray(views)?views:[]); setShowSaveView(false); setNewViewName(''); }} className="bg-indigo-600 text-white px-2 py-1 rounded text-xs hover:bg-indigo-700">Save</button>
              <button onClick={()=>setShowSaveView(false)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
            </div>
          ) : (
            <button onClick={()=>setShowSaveView(true)} className="px-3 py-1 rounded-lg text-xs border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition">
              + Save current view
            </button>
          )}
        </div>
      )}

      {/* ── Quick filter tabs ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          { key:'all',      label:'All Tickets',      params:{} },
          { key:'open',     label:'Open',             params:{ status:'open' } },
          { key:'mine',      label:'Mine',             params:{ status:'open', assigned:'me' } },
          { key:'unassigned',label:'Unassigned',      params:{ assigned:'unassigned' } },
          { key:'overdue',  label:'Overdue',          params:{ status:'overdue' } },
        ].map(f => (
          <button key={f.key}
                  onClick={() => applyFilter(f.key, f.label, f.params)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeFilter.key===f.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Search + secondary filters ── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input type="text" placeholder="Search tickets..." value={searchTerm}
                 onChange={e=>{ setSearchTerm(e.target.value); setPage(1); }}
                 className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={filterType} onChange={e=>{ setFilterType(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            <option value="">All types</option>
            <option value="incident">Incidents</option>
            <option value="service_request">Service Requests</option>
          </select>
          <select value={filterGroup} onChange={e=>{ setFilterGroup(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            <option value="">All groups</option>
            {groupList.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={sortBy} onChange={e=>{ setSortBy(e.target.value); setPage(1); }}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            <option value="">Newest first</option>
            <option value="priority">Priority</option>
            <option value="sla">SLA deadline</option>
          </select>
          {(filterType||filterGroup||sortBy) && (
            <button onClick={() => { setFilterType(''); setFilterGroup(''); setSortBy(''); setPage(1); }}
                    className="text-sm text-red-500 hover:text-red-700 px-2">× Clear</button>
          )}
        </div>
      </div>

      {/* Employee quick-create */}
      {user?.role==='employee' && (
        <div className="flex gap-2 mb-4">
          <Link to="/create-ticket?type=incident"         className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition">🚨 Report Incident</Link>
          <Link to="/create-ticket?type=service_request"  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition">📋 Service Request</Link>
        </div>
      )}

      {/* ── Ticket list ── */}
      <div id="ticket-list" className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 min-h-[400px]">
        {/* List header */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white">
              {activeFilter.label || 'All Tickets'}
              <span className="ml-2 text-sm font-normal text-gray-400">({total})</span>
            </h2>
            <div className="flex items-center gap-1.5" title="Auto-refreshes every 60s">
              <div className={`w-2 h-2 rounded-full ${refreshing?'bg-indigo-400 animate-pulse':'bg-green-400'}`} />
              <span className="text-xs text-gray-400">{lastRefresh.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
              <button onClick={() => fetchTickets()} title="Refresh now" className="text-gray-300 hover:text-indigo-500 text-xs transition">↻</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAgentOrAdmin && (
              <button onClick={()=>setShowSaveView(true)} className="text-xs text-gray-400 hover:text-indigo-500 border border-dashed border-gray-300 dark:border-gray-600 px-2 py-1 rounded-lg transition">
                📌 Save view
              </button>
            )}
            <div className="flex border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
              {[['comfortable','☰'],['compact','≡']].map(([d,icon]) => (
                <button key={d} onClick={()=>saveDensity(d)}
                        className={`px-2 py-1.5 text-xs transition ${density===d?'bg-indigo-600 text-white':'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Active filter pill */}
        {activeFilter.label && (
          <div className="px-5 pt-3">
            <ActiveFilterPill label={activeFilter.label} onClear={clearFilter} />
          </div>
        )}

        {/* Bulk toolbar */}
        {isAgentOrAdmin && selectedIds.size>0 && (
          <div className="px-5 py-2 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800 flex items-center gap-2 flex-wrap">
            <span className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">{selectedIds.size} selected</span>
            <select value={bulkAction} onChange={e=>{setBulkAction(e.target.value);setBulkValue('');}}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">Action...</option>
              <option value="assign">Assign to agent</option>
              <option value="status">Change status</option>
              <option value="priority">Change priority</option>
            </select>
            {bulkAction==='assign' && (
              <select value={bulkValue} onChange={e=>setBulkValue(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Select agent...</option>
                {agentList.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            )}
            {bulkAction==='status' && (
              <select value={bulkValue} onChange={e=>setBulkValue(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Select status...</option>
                {['open','in_progress','resolved','closed'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
              </select>
            )}
            {bulkAction==='priority' && (
              <select value={bulkValue} onChange={e=>setBulkValue(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Select priority...</option>
                {['low','medium','high','critical'].map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <button onClick={handleBulkApply} disabled={bulkLoading||!bulkAction||!bulkValue}
                    className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition">
              {bulkLoading?'Applying...':'Apply'}
            </button>
            <button onClick={()=>setSelectedIds(new Set())} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">Clear</button>
          </div>
        )}

        {/* Rows */}
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading...</div>
        ) : tickets.length===0 ? (
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">🎉</p>
            <p className="text-gray-400 text-sm">
              {activeFilter.label ? `No tickets match "${activeFilter.label}"` : 'No tickets found'}
            </p>
            {activeFilter.label && (
              <button onClick={clearFilter} className="mt-2 text-indigo-500 hover:underline text-sm">Clear filter</button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {isAgentOrAdmin && (
              <li className="px-5 py-2 bg-gray-50 dark:bg-gray-700/50 flex items-center gap-3">
                <input type="checkbox" checked={selectedIds.size===tickets.length&&tickets.length>0} onChange={toggleSelectAll}
                       className="w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer" />
                <span className="text-xs text-gray-500 dark:text-gray-400">{selectedIds.size===tickets.length?'Deselect all':'Select all on page'}</span>
              </li>
            )}
            {tickets.map(ticket => {
              const countdown = slaCountdown(ticket.sla_resolution_deadline);
              const statusKey = ticket.status?.replace(' ','_') || 'open';
              return (
                <li key={ticket.id}
                    className={`${rowPad} hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 transition ${selectedIds.has(ticket.id)?'bg-indigo-50 dark:bg-indigo-900/20':''}`}>
                  {isAgentOrAdmin && (
                    <input type="checkbox" checked={selectedIds.has(ticket.id)} onChange={()=>toggleSelect(ticket.id)}
                           onClick={e=>e.stopPropagation()}
                           className="w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer flex-shrink-0" />
                  )}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ticket.sla_status==='overdue'?'bg-red-500':ticket.sla_status==='warning'?'bg-yellow-400':'bg-green-400'}`} title={`SLA: ${ticket.sla_status}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/tickets/${ticket.id}`} className="font-medium text-gray-800 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 truncate text-sm">
                        {formatId(ticket.id, ticket.ticket_type)} — {ticket.title}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {ticket.requester_name} · {new Date(ticket.created_at).toLocaleDateString()} · {ticket.category || 'General'}
                      </span>
                      {ticket.tags?.slice(0,3).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 border border-indigo-100 dark:border-indigo-800">#{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    {ticket.assigned_to_name && <Avatar name={ticket.assigned_to_name} availability={ticket.assigned_to_availability} />}
                    <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_CLASSES[statusKey]||STATUS_CLASSES.open}`}>
                      {statusKey.replace(/_/g,' ')}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_CLASSES[ticket.priority]}`}>
                      {ticket.priority}
                    </span>
                    {ticket.sla_status==='overdue' ? (
                      <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300 font-medium">⚠ Overdue</span>
                    ) : countdown ? (
                      <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full font-medium ${ticket.sla_status==='warning'?'bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300':'bg-gray-50 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                        ⏱ {countdown}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-gray-100 dark:border-gray-700 px-6 py-2">
          <Pagination total={total} page={page} limit={LIMIT} onPageChange={p=>setPage(p)} />
        </div>
      </div>
    </Layout>
  );
}
