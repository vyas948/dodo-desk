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
const AUTO_REFRESH_MS = 60000; // 1 minute

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
const SLA_CLASSES = {
  ok:      'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300',
  warning: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  overdue: 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300',
};
const PIE_COLORS      = ['#6366f1','#22c55e','#f59e0b','#ef4444','#8b5cf6'];
const PRIORITY_COLORS = { low:'#22c55e', medium:'#6366f1', high:'#f59e0b', critical:'#ef4444' };

const FILTERS = [
  { key: 'all',         label: 'dashboard.allTickets',    params: {} },
  { key: 'open',        label: 'dashboard.open',          params: { status: 'open' } },
  { key: 'mine',        label: 'dashboard.myOpenTickets', params: { status: 'open' } },
  { key: 'unassigned',  label: 'dashboard.unassigned',    params: { assigned: 'unassigned' } },
  { key: 'overdue',     label: 'dashboard.overdue',       params: { status: 'overdue' } },
  { key: 'resolved',    label: 'dashboard.resolved',      params: { status: 'resolved' } },
  { key: 'critical',    label: 'dashboard.critical',      params: { priority: 'critical' } },
  { key: 'in_progress', label: 'dashboard.inProgress',    params: { status: 'in_progress' } },
];

// SLA countdown: returns human-readable string from deadline ISO string
function slaCountdown(deadline) {
  if (!deadline) return null;
  const diff = new Date(deadline) - new Date();
  if (diff <= 0) return null; // already overdue — show badge instead
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h/24)}d ${h%24}h`;
  if (h > 0)   return `${h}h ${m}m`;
  return `${m}m`;
}

// Assignee avatar initials
function Avatar({ name, size = 'sm' }) {
  if (!name) return null;
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['bg-indigo-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-violet-500','bg-cyan-500'];
  const color  = colors[name.charCodeAt(0) % colors.length];
  const cls    = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';
  return (
    <div className={`${cls} ${color} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`} title={name}>
      {initials}
    </div>
  );
}

export default function Dashboard() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  // Ticket list state
  const [tickets, setTickets]           = useState([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [loading, setLoading]           = useState(true);
  const [searchTerm, setSearchTerm]     = useState('');
  const [activeFilter, setActiveFilter] = useState(() => {
    const f = searchParams.get('filter');
    return FILTERS.find(x => x.key === f) ? f : 'all';
  });
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterType, setFilterType]         = useState('');
  const [filterGroup, setFilterGroup]       = useState('');
  const [sortBy, setSortBy]                 = useState('');
  const [density, setDensity]               = useState(() => localStorage.getItem('dashDensity') || 'comfortable');

  // Bulk actions
  const [selectedIds, setSelectedIds]   = useState(new Set());
  const [bulkAction, setBulkAction]     = useState('');
  const [bulkValue, setBulkValue]       = useState('');
  const [bulkLoading, setBulkLoading]   = useState(false);

  // Data
  const [agentList, setAgentList]       = useState([]);
  const [groupList, setGroupList]       = useState([]);
  const [savedViews, setSavedViews]     = useState([]);
  const [showSaveView, setShowSaveView] = useState(false);
  const [newViewName, setNewViewName]   = useState('');
  const [newViewShared, setNewViewShared] = useState(false);

  // KPI + charts
  const [summaryStats, setSummaryStats]   = useState({ open:0, resolvedToday:0, overdue:0, openChanges:0 });
  const [myStats, setMyStats]             = useState(null);
  const [expiringCount, setExpiringCount] = useState(0);
  const [byStatus, setByStatus]           = useState([]);
  const [byPriority, setByPriority]       = useState([]);
  const [daily, setDaily]                 = useState([]);
  const [chartsLoading, setChartsLoading] = useState(true);

  // Auto-refresh
  const [lastRefresh, setLastRefresh]   = useState(new Date());
  const [refreshing, setRefreshing]     = useState(false);
  const refreshTimer                    = useRef(null);

  // Dark mode detection for recharts
  const darkMode       = document.documentElement.classList.contains('dark');
  const chartTextColor = darkMode ? '#9ca3af' : '#6b7280';
  const chartGridColor = darkMode ? '#374151' : '#e5e7eb';
  const tooltipStyle   = darkMode
    ? { backgroundColor:'#1f2937', border:'1px solid #374151', color:'#e5e7eb' }
    : { backgroundColor:'#fff',    border:'1px solid #e5e7eb', color:'#111827' };

  // ── Fetch tickets ──────────────────────────────────────────────────────────
  const fetchTickets = useCallback(async (filter = activeFilter, search = searchTerm, p = page, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const filterDef = FILTERS.find(f => f.key === filter) || FILTERS[0];
      const params = new URLSearchParams(filterDef.params);
      if (search)        params.append('search', search);
      if (filterPriority) params.append('priority', filterPriority);
      if (filterCategory) params.append('category', filterCategory);
      if (filterType)    params.append('ticket_type', filterType);
      if (filterGroup)   params.append('group_id', filterGroup);
      if (sortBy)        params.append('sort_by', sortBy);
      params.append('skip', (p - 1) * LIMIT);
      params.append('limit', LIMIT);
      const data = await apiFetch(`/tickets/?${params}`, token);
      setTickets(data.items ?? []);
      setTotal(data.total ?? 0);
      if (!silent) setSelectedIds(new Set());
      setLastRefresh(new Date());
    } catch(err) { if (!silent) toast.error(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [activeFilter, searchTerm, page, filterPriority, filterCategory, filterType, filterGroup, sortBy, token]);

  // ── Fetch charts + summary ─────────────────────────────────────────────────
  const fetchCharts = useCallback(async () => {
    if (!isAgentOrAdmin || !token) return;
    setChartsLoading(true);
    try {
      const [statusData, priorityData, dailyData] = await Promise.all([
        apiFetch('/reports/tickets-by-status', token),
        apiFetch('/reports/tickets-by-priority', token),
        apiFetch('/reports/tickets-created-daily', token),
      ]);
      setByStatus(Array.isArray(statusData)   ? statusData   : []);
      setByPriority(Array.isArray(priorityData) ? priorityData : []);
      setDaily(Array.isArray(dailyData) ? dailyData.slice(-14) : []);
    } catch {}
    finally { setChartsLoading(false); }
  }, [isAgentOrAdmin, token]);

  const fetchSummary = useCallback(async () => {
    try {
      if (isAgentOrAdmin) {
        const [rep, ms] = await Promise.all([
          apiFetch('/reports/summary', token),
          apiFetch('/reports/my-stats', token),
        ]);
        setSummaryStats({ open: rep.open??0, resolvedToday: rep.resolved_today??0, overdue: rep.overdue??0, openChanges: rep.open_changes??0 });
        setMyStats(ms);
      } else {
        const [openData, overdueData] = await Promise.all([
          apiFetch('/tickets/?status=open&limit=1', token),
          apiFetch('/tickets/?status=overdue&limit=1', token),
        ]);
        setSummaryStats({ open: openData.total??0, resolvedToday:0, overdue: overdueData.total??0, openChanges:0 });
      }
    } catch {}
  }, [isAgentOrAdmin, token]);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchSummary();
    fetchCharts();
    if (isAgentOrAdmin) {
      apiFetch('/assets/expiring?days=30', token).then(d => setExpiringCount(Array.isArray(d)?d.length:0)).catch(()=>{});
      apiFetch('/users/', token).then(d => { const u = Array.isArray(d)?d:(d.items??[]); setAgentList(u.filter(x=>['agent','admin','super_admin'].includes(x.role))); }).catch(()=>{});
      apiFetch('/groups/', token).then(d => setGroupList(Array.isArray(d)?d:[])).catch(()=>{});
      apiFetch('/ticket-views/', token).then(d => setSavedViews(Array.isArray(d)?d:[])).catch(()=>{});
    }
  }, [token, user]);

  // ── Ticket list re-fetch on filter/search/page change ─────────────────────
  useEffect(() => {
    const delay = searchTerm ? 300 : 0;
    const timer = setTimeout(() => fetchTickets(activeFilter, searchTerm, page), delay);
    return () => clearTimeout(timer);
  }, [token, activeFilter, searchTerm, page, filterPriority, filterCategory, filterType, filterGroup, sortBy]);

  // ── Auto-refresh every 60s ─────────────────────────────────────────────────
  useEffect(() => {
    refreshTimer.current = setInterval(() => {
      fetchTickets(activeFilter, searchTerm, page, true);
      fetchSummary();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(refreshTimer.current);
  }, [activeFilter, searchTerm, page, filterPriority, filterCategory, filterType, filterGroup, sortBy, token]);

  // ── Chatbot event ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => { fetchTickets(activeFilter, searchTerm, page); fetchCharts(); };
    window.addEventListener('dodesk:ticket-created', handler);
    return () => window.removeEventListener('dodesk:ticket-created', handler);
  }, [activeFilter, searchTerm, page, token]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const handleStatClick = (filterKey) => {
    setActiveFilter(filterKey); setSearchTerm(''); setPage(1); setSelectedIds(new Set());
    setTimeout(() => {
      const el = document.getElementById('ticket-list');
      if (el) { const r = el.getBoundingClientRect(); if (r.top > window.innerHeight) el.scrollIntoView({ behavior:'smooth', block:'start' }); }
    }, 100);
  };

  const toggleSelect    = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelectedIds(selectedIds.size===tickets.length ? new Set() : new Set(tickets.map(t=>t.id)));

  const handleBulkApply = async () => {
    if (!bulkAction || !bulkValue || selectedIds.size===0) { toast.error('Select tickets, action and value'); return; }
    setBulkLoading(true);
    try {
      const res = await apiFetch('/tickets/bulk-update', token, { method:'POST', body:JSON.stringify({ ticket_ids:[...selectedIds], action:bulkAction, value:bulkValue }) });
      toast.success(`${res.updated} ticket(s) updated`);
      setSelectedIds(new Set()); setBulkAction(''); setBulkValue('');
      fetchTickets(activeFilter, searchTerm, page);
    } catch(err) { toast.error(err.message); }
    finally { setBulkLoading(false); }
  };

  const clearFilters = () => { setFilterType(''); setFilterPriority(''); setFilterCategory(''); setFilterGroup(''); setSortBy(''); setPage(1); };

  const saveDensity = (d) => { setDensity(d); localStorage.setItem('dashDensity', d); };

  // ── CSS helpers ────────────────────────────────────────────────────────────
  const statCard  = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const clickStat = `${statCard} cursor-pointer hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-all select-none`;
  const chartCard = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const fActive   = "px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white shadow-sm";
  const fInactive = "px-4 py-2 rounded-lg text-sm font-medium bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition";
  const rowPad    = density === 'compact' ? 'px-5 py-2.5' : 'px-5 py-4';

  return (
    <Layout>
      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
        <div className={clickStat} onClick={() => handleStatClick(isAgentOrAdmin ? 'open' : 'mine')}>
          <p className="text-sm text-gray-500 dark:text-gray-400">{isAgentOrAdmin ? t('dashboard.open') : t('dashboard.myOpenTickets')}</p>
          <p className="text-3xl font-bold text-blue-700 dark:text-blue-400">{summaryStats.open}</p>
          <p className="text-xs text-blue-400 mt-1">Click to filter →</p>
        </div>
        <div className={clickStat} onClick={() => handleStatClick('resolved')}>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.resolvedToday')}</p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">{summaryStats.resolvedToday}</p>
          <p className="text-xs text-green-400 mt-1">Click to filter →</p>
        </div>
        <div className={clickStat} onClick={() => handleStatClick('overdue')}>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.overdue')}</p>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400">{summaryStats.overdue}</p>
          <p className="text-xs text-red-400 mt-1">Click to filter →</p>
        </div>
        {isAgentOrAdmin && (
          <Link to="/changes" className={`${statCard} hover:shadow-md hover:border-purple-200 dark:hover:border-purple-700 transition-all`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.openChanges')||'Open Changes'}</p>
            <p className="text-3xl font-bold text-purple-700 dark:text-purple-400">{summaryStats.openChanges}</p>
            <p className="text-xs text-purple-400 mt-1">Click to view →</p>
          </Link>
        )}
        {isAgentOrAdmin && expiringCount > 0 && (
          <Link to="/assets" className={`${statCard} hover:shadow-md hover:border-yellow-200 dark:hover:border-yellow-700 transition-all`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.expiringLicenses')}</p>
            <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-400">{expiringCount}</p>
            <p className="text-xs text-yellow-400 mt-1">Click to view →</p>
          </Link>
        )}
      </div>

      {/* ── My Work panel (agents/admins only) ────────────────────────────── */}
      {isAgentOrAdmin && myStats && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">👤 My Work</h3>
            <span className="text-xs text-indigo-400">Assigned to me</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label:'Assigned Open',  value: myStats.assigned_open,    color:'text-indigo-700 dark:text-indigo-300', filter:'mine' },
              { label:'Due Today',      value: myStats.due_today,        color:'text-amber-700 dark:text-amber-300',   filter:null },
              { label:'Overdue (Mine)', value: myStats.overdue_mine,     color:'text-red-700 dark:text-red-300',       filter:'overdue' },
              { label:'Resolved This Week', value: myStats.resolved_week, color:'text-green-700 dark:text-green-300', filter:null },
              { label:'Avg Resolution', value: myStats.avg_resolution_hours ? `${myStats.avg_resolution_hours}h` : '—', color:'text-gray-700 dark:text-gray-300', filter:null },
            ].map(({ label, value, color, filter }) => (
              <div key={label}
                   className={`text-center ${filter ? 'cursor-pointer hover:opacity-80' : ''}`}
                   onClick={() => filter && handleStatClick(filter)}>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      {isAgentOrAdmin && !chartsLoading && (byStatus.length>0 || byPriority.length>0 || daily.length>0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {byStatus.length > 0 && (
            <div className={chartCard}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('reports.ticketsByStatus')}</h3>
              <p className="text-xs text-gray-400 mb-3">Click a slice to filter</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={50} outerRadius={80} cursor="pointer"
                       onClick={d => { if (d?.status) { const k = d.status==='open'?'open':d.status==='overdue'?'overdue':d.status==='resolved'?'resolved':'all'; setFilterPriority(''); setFilterCategory(''); setFilterType(''); handleStatClick(k); } }}>
                    {byStatus.map((_,i) => <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color:chartTextColor, fontSize:12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {byPriority.length > 0 && (
            <div className={chartCard}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('reports.ticketsByPriority')}</h3>
              <p className="text-xs text-gray-400 mb-3">Click a bar to filter</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byPriority} barSize={32} style={{cursor:'pointer'}}
                          onClick={d => { const p = d?.activePayload?.[0]?.payload?.priority; if (p) { setFilterPriority(p); setFilterCategory(''); setFilterType(''); setSortBy(''); setActiveFilter('all'); setPage(1); setSearchTerm(''); setTimeout(()=>document.getElementById('ticket-list')?.scrollIntoView({behavior:'smooth'}),100); } }}>
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
            <div className={chartCard}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('reports.ticketsCreated')} (14d)</h3>
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

      {/* ── Saved Views ───────────────────────────────────────────────────── */}
      {isAgentOrAdmin && (savedViews.length>0 || showSaveView) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs text-gray-400 font-medium">📌 Views:</span>
          {savedViews.map(v => (
            <button key={v.id}
                    onClick={() => { const f=JSON.parse(v.filters||'{}'); if(f.status) setActiveFilter(f.status); else setActiveFilter('all'); if(f.priority) setFilterPriority(f.priority); if(f.category) setFilterCategory(f.category); if(f.ticket_type) setFilterType(f.ticket_type); setSearchTerm(f.search||''); setPage(1); }}
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
                <input type="checkbox" checked={newViewShared} onChange={e=>setNewViewShared(e.target.checked)} className="rounded" />
                Shared
              </label>
              <button onClick={async()=>{ if(!newViewName.trim()) return; const filters={status:activeFilter,priority:filterPriority,category:filterCategory,ticket_type:filterType,search:searchTerm}; await apiFetch('/ticket-views/',token,{method:'POST',body:JSON.stringify({name:newViewName,filters,is_shared:newViewShared})}); const views=await apiFetch('/ticket-views/',token); setSavedViews(Array.isArray(views)?views:[]); setShowSaveView(false); setNewViewName(''); }} className="bg-indigo-600 text-white px-2 py-1 rounded text-xs hover:bg-indigo-700">Save</button>
              <button onClick={()=>setShowSaveView(false)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
            </div>
          ) : (
            <button onClick={()=>setShowSaveView(true)} className="px-3 py-1 rounded-lg text-xs border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition">
              + Save current view
            </button>
          )}
        </div>
      )}

      {/* ── Filter tabs ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.filter(f => {
          if (f.key==='mine' && isAgentOrAdmin) return false;
          if (f.key==='open' && !isAgentOrAdmin) return false;
          if (['resolved','critical','in_progress'].includes(f.key)) return false;
          return true;
        }).map(f => (
          <button key={f.key} onClick={() => { setActiveFilter(f.key); setSearchTerm(''); setPage(1); setFilterPriority(''); setFilterCategory(''); setFilterType(''); setFilterGroup(''); setSortBy(''); }}
                  className={activeFilter===f.key ? fActive : fInactive}>
            {t(f.label)}
          </button>
        ))}
        {['resolved','critical','in_progress'].includes(activeFilter) && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
            {activeFilter==='resolved'&&'✅ Resolved'}{activeFilter==='critical'&&'🔴 Critical'}{activeFilter==='in_progress'&&'⚙ In Progress'}
            <button onClick={()=>{ setActiveFilter('all'); setPage(1); }} className="ml-1 hover:text-indigo-900 font-bold">×</button>
          </span>
        )}
      </div>

      {/* ── Search + advanced filters ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input type="text" placeholder={t('common.search')+'...'} value={searchTerm}
                 onChange={e=>{setSearchTerm(e.target.value); setPage(1);}}
                 className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { value:filterType,     setter:v=>{setFilterType(v);setPage(1);},     opts:[{v:'',l:'All types'},{v:'incident',l:'Incidents'},{v:'service_request',l:'Service Requests'}] },
            { value:filterPriority, setter:v=>{setFilterPriority(v);setPage(1);}, opts:[{v:'',l:'All priorities'},{v:'critical',l:'Critical'},{v:'high',l:'High'},{v:'medium',l:'Medium'},{v:'low',l:'Low'}] },
            { value:filterCategory, setter:v=>{setFilterCategory(v);setPage(1);}, opts:[{v:'',l:'All categories'},...['Hardware','Software','Network','Account','Email','Security','Printer','Mobile Device','Cloud Services','Telephony','Other'].map(c=>({v:c,l:c}))] },
            { value:filterGroup,    setter:v=>{setFilterGroup(v);setPage(1);},    opts:[{v:'',l:'All groups'},...groupList.map(g=>({v:String(g.id),l:g.name}))] },
            { value:sortBy,         setter:v=>{setSortBy(v);setPage(1);},          opts:[{v:'',l:'Newest first'},{v:'priority',l:'Sort: Priority'},{v:'sla',l:'Sort: SLA'}] },
          ].map((s,i) => (
            <select key={i} value={s.value} onChange={e=>s.setter(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 min-w-[120px]">
              {s.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          ))}
          {(filterType||filterPriority||filterCategory||filterGroup||sortBy) && (
            <button onClick={clearFilters} className="text-sm text-red-500 hover:text-red-700 px-2">× Clear</button>
          )}
        </div>
      </div>

      {/* Employee quick-create buttons */}
      {user?.role==='employee' && (
        <div className="flex gap-2 mb-4">
          <Link to="/create-ticket?type=incident"        className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition">{t('dashboard.reportIncident')}</Link>
          <Link to="/create-ticket?type=service_request" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition">{t('dashboard.serviceRequest')}</Link>
        </div>
      )}

      {/* ── Ticket list ────────────────────────────────────────────────────── */}
      <div id="ticket-list" className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 min-h-[400px]">
        {/* List header */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white">
              {activeFilter==='all' ? t('dashboard.recentTickets') : t(FILTERS.find(f=>f.key===activeFilter)?.label||'dashboard.recentTickets')}
              <span className="ml-2 text-sm font-normal text-gray-400">({total})</span>
            </h2>
            {/* Auto-refresh indicator */}
            <div className="flex items-center gap-1.5" title="Auto-refreshes every 60s">
              <div className={`w-2 h-2 rounded-full ${refreshing ? 'bg-indigo-400 animate-pulse' : 'bg-green-400'}`} />
              <span className="text-xs text-gray-400">{lastRefresh.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
              <button onClick={() => fetchTickets(activeFilter, searchTerm, page)} title="Refresh now" className="text-gray-300 hover:text-indigo-500 transition text-xs">↻</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Density toggle */}
            <div className="flex border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
              {[['comfortable','☰'],['compact','≡']].map(([d,icon])=>(
                <button key={d} onClick={()=>saveDensity(d)} title={d}
                        className={`px-2 py-1.5 text-xs transition ${density===d ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bulk action toolbar */}
        {isAgentOrAdmin && selectedIds.size>0 && (
          <div className="px-5 py-2 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800 flex items-center gap-2 flex-wrap">
            <span className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">{selectedIds.size} selected</span>
            <select value={bulkAction} onChange={e=>{setBulkAction(e.target.value);setBulkValue('');}}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">Action...</option>
              <option value="assign">Assign to agent</option>
              {groupList.length>0 && <option value="assign_group">Assign to group</option>}
              <option value="status">Change status</option>
              <option value="priority">Change priority</option>
            </select>
            {bulkAction==='assign' && (
              <select value={bulkValue} onChange={e=>setBulkValue(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Select agent...</option>
                {agentList.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            )}
            {bulkAction==='assign_group' && (
              <select value={bulkValue} onChange={e=>setBulkValue(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">Select group...</option>
                {groupList.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
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
              {bulkLoading ? 'Applying...' : 'Apply'}
            </button>
            <button onClick={()=>setSelectedIds(new Set())} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">Clear</button>
          </div>
        )}

        {/* Ticket rows */}
        {loading ? (
          <div className="p-10 text-center text-gray-400">{t('common.loading')}</div>
        ) : tickets.length===0 ? (
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">🎉</p>
            <p className="text-gray-400">{t('dashboard.noTickets')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {/* Select-all row */}
            {isAgentOrAdmin && (
              <li className="px-5 py-2 bg-gray-50 dark:bg-gray-700/50 flex items-center gap-3">
                <input type="checkbox" checked={selectedIds.size===tickets.length&&tickets.length>0} onChange={toggleSelectAll}
                       className="w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedIds.size===tickets.length ? 'Deselect all' : 'Select all on page'}
                </span>
              </li>
            )}

            {tickets.map(ticket => {
              const countdown = slaCountdown(ticket.sla_resolution_deadline);
              const statusKey = ticket.status?.replace(' ','_') || 'open';
              return (
                <li key={ticket.id}
                    className={`${rowPad} hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 transition ${selectedIds.has(ticket.id) ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                  {/* Checkbox */}
                  {isAgentOrAdmin && (
                    <input type="checkbox" checked={selectedIds.has(ticket.id)} onChange={()=>toggleSelect(ticket.id)}
                           onClick={e=>e.stopPropagation()}
                           className="w-4 h-4 rounded border-gray-300 text-indigo-600 cursor-pointer flex-shrink-0" />
                  )}

                  {/* SLA dot */}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ticket.sla_status==='overdue'?'bg-red-500':ticket.sla_status==='warning'?'bg-yellow-400':'bg-green-400'}`}
                       title={`SLA: ${ticket.sla_status}`} />

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/tickets/${ticket.id}`} className="font-medium text-gray-800 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 truncate text-sm">
                        {formatId(ticket.id, ticket.ticket_type)} — {ticket.title}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {ticket.requester_name} · {new Date(ticket.created_at).toLocaleDateString()} · {ticket.category||t('common.general')}
                      </span>
                      {ticket.tags?.length>0 && ticket.tags.slice(0,3).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800">#{tag}</span>
                      ))}
                    </div>
                  </div>

                  {/* Right-side badges */}
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    {/* Assignee avatar */}
                    {ticket.assigned_to_name && <Avatar name={ticket.assigned_to_name} />}

                    {/* Status badge */}
                    <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_CLASSES[statusKey]||STATUS_CLASSES.open}`}>
                      {statusKey.replace(/_/g,' ')}
                    </span>

                    {/* Type badge */}
                    <span className={`hidden md:inline text-xs px-2 py-0.5 rounded-full font-medium ${ticket.ticket_type==='incident'?'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300':'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300'}`}>
                      {ticket.ticket_type==='incident'?'INC':'REQ'}
                    </span>

                    {/* Priority badge */}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_CLASSES[ticket.priority]}`}>
                      {t(`ticket.${ticket.priority}`)}
                    </span>

                    {/* SLA countdown or overdue badge */}
                    {ticket.sla_status==='overdue' ? (
                      <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300">⚠ Overdue</span>
                    ) : countdown ? (
                      <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full font-medium ${ticket.sla_status==='warning' ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' : 'bg-gray-50 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
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
