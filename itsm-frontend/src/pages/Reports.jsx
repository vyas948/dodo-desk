import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import { API } from '../api';
import Layout from '../components/Layout';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadialBarChart, RadialBar
} from 'recharts';

const COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
const DATE_PRESETS = [
  { label: 'Today',    days: 0 },
  { label: 'Last 7d',  days: 7 },
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
  { label: 'Custom',   days: -1 },
];

function kpiCard(icon, label, value, sub, color = 'indigo') {
  const colors = {
    indigo: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-800',
    green:  'bg-green-50  dark:bg-green-900/20  border-green-100  dark:border-green-800',
    amber:  'bg-amber-50  dark:bg-amber-900/20  border-amber-100  dark:border-amber-800',
    red:    'bg-red-50    dark:bg-red-900/20    border-red-100    dark:border-red-800',
    blue:   'bg-blue-50   dark:bg-blue-900/20   border-blue-100   dark:border-blue-800',
    teal:   'bg-teal-50   dark:bg-teal-900/20   border-teal-100   dark:border-teal-800',
  };
  const textColors = {
    indigo: 'text-indigo-600 dark:text-indigo-400',
    green:  'text-green-600  dark:text-green-400',
    amber:  'text-amber-600  dark:text-amber-400',
    red:    'text-red-600    dark:text-red-400',
    blue:   'text-blue-600   dark:text-blue-400',
    teal:   'text-teal-600   dark:text-teal-400',
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-2xl mb-1">{icon}</p>
      <p className={`text-3xl font-bold ${textColors[color]}`}>{value ?? '—'}</p>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const SectionTitle = ({ children }) => (
  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{children}</h3>
);

const ChartCard = ({ title, children, height = 260 }) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{title}</h4>
    <div style={{ height }}>{children}</div>
  </div>
);

export default function Reports() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();

  // Filters
  const [preset, setPreset]           = useState('Last 30d');
  const [ticketType, setTicketType]   = useState('');
  const [startDate, setStartDate]     = useState('');
  const [endDate, setEndDate]         = useState('');
  const [activeTab, setActiveTab]     = useState('tickets');

  // Data
  const [summary, setSummary]         = useState(null);
  const [byPriority, setByPriority]   = useState([]);
  const [byStatus, setByStatus]       = useState([]);
  const [byCategory, setByCategory]   = useState([]);
  const [daily, setDaily]             = useState([]);
  const [agentWorkload, setAgentWorkload] = useState([]);
  const [slaCompliance, setSlaCompliance] = useState(null);
  const [csat, setCsat]               = useState(null);
  const [csatTrend, setCsatTrend]     = useState([]);
  const [resTrend, setResTrend]       = useState([]);
  const [frtTrend, setFrtTrend]       = useState([]);
  const [aging, setAging]             = useState([]);
  const [changesSummary, setChangesSummary] = useState(null);
  const [kbAnalytics, setKbAnalytics] = useState(null);
  const [assetSummary, setAssetSummary] = useState(null);
  const [loading, setLoading]         = useState(false);

  const getDateRange = useCallback(() => {
    if (preset === 'Custom') return { start: startDate, end: endDate };
    if (preset === 'Today') {
      const today = new Date().toISOString().slice(0, 10);
      return { start: today, end: today };
    }
    const days = DATE_PRESETS.find(p => p.label === preset)?.days || 30;
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return { start, end };
  }, [preset, startDate, endDate]);

  const buildParams = useCallback(() => {
    const { start, end } = getDateRange();
    const params = new URLSearchParams();
    if (ticketType) params.append('ticket_type', ticketType);
    if (start) params.append('start_date', start);
    if (end) params.append('end_date', end);
    return params.toString();
  }, [getDateRange, ticketType]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const q = buildParams();
    const cq = (() => { const p = new URLSearchParams(); const { start, end } = getDateRange(); if (start) p.append('start_date', start); if (end) p.append('end_date', end); return p.toString(); })();
    try {
      const [sum, pri, sta, cat, day, agents, sla, csatData, csatTr, resTr, frtTr, age, changes, kb, assets] = await Promise.allSettled([
        apiFetch(`/reports/summary?${q}`, token),
        apiFetch(`/reports/tickets-by-priority?${q}`, token),
        apiFetch(`/reports/tickets-by-status?${q}`, token),
        apiFetch(`/reports/tickets-by-category?${q}`, token),
        apiFetch(`/reports/tickets-created-daily?${q}`, token),
        apiFetch(`/reports/agent-workload?${q}`, token),
        apiFetch(`/reports/sla-compliance?${q}`, token),
        apiFetch(`/reports/csat?${cq}`, token),
        apiFetch(`/reports/csat-trend?${cq}`, token),
        apiFetch(`/reports/resolution-time-trend?${q}`, token),
        apiFetch(`/reports/first-response-trend?${q}`, token),
        apiFetch(`/reports/tickets-aging`, token),
        apiFetch(`/reports/changes-summary?${cq}`, token),
        apiFetch(`/reports/kb-analytics`, token),
        apiFetch(`/reports/asset-summary`, token),
      ]);
      const get = r => r.status === 'fulfilled' ? r.value : null;
      setSummary(get(sum));
      setByPriority(get(pri) || []);
      setByStatus(get(sta) || []);
      setByCategory(get(cat) || []);
      setDaily(get(day) || []);
      setAgentWorkload(get(agents) || []);
      setSlaCompliance(get(sla));
      setCsat(get(csatData));
      setCsatTrend(get(csatTr) || []);
      setResTrend(get(resTr) || []);
      setFrtTrend(get(frtTr) || []);
      setAging(get(age) || []);
      setChangesSummary(get(changes));
      setKbAnalytics(get(kb));
      setAssetSummary(get(assets));
    } catch(e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [buildParams, getDateRange, token]);

  useEffect(() => { fetchAll(); }, [preset, ticketType, startDate, endDate]);

  const handleExportCSV = () => {
    const q = buildParams();
    window.open(`${API}/reports/export/csv?${q}`, '_blank');
  };

  const handleExportExcel = () => {
    const q = buildParams();
    window.open(`${API}/reports/export/excel?${q}`, '_blank');
  };

  const tabs = [
    { key: 'tickets',  label: '🎫 Tickets' },
    { key: 'agents',   label: '👥 Agents' },
    { key: 'sla',      label: '⏱️ SLA' },
    { key: 'csat',     label: '⭐ CSAT' },
    { key: 'changes',  label: '🔄 Changes' },
    { key: 'kb',       label: '📚 KB' },
    { key: 'assets',   label: '💻 Assets' },
  ];

  const inp = "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">📊 {t('common.reports')}</h2>
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleExportCSV} className={inp + " hover:bg-gray-50 dark:hover:bg-gray-700 transition cursor-pointer"}>
              📄 Export CSV
            </button>
            <button onClick={handleExportExcel} className={inp + " hover:bg-gray-50 dark:hover:bg-gray-700 transition cursor-pointer"}>
              📊 Export Excel
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3 flex-wrap">
          {/* Date presets */}
          <div className="flex gap-1 flex-wrap">
            {DATE_PRESETS.map(p => (
              <button key={p.label} onClick={() => setPreset(p.label)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${preset === p.label ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'Custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inp} />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inp} />
            </div>
          )}
          {/* Ticket type filter */}
          <select value={ticketType} onChange={e => setTicketType(e.target.value)} className={inp}>
            <option value="">All types</option>
            <option value="incident">Incidents</option>
            <option value="service_request">Service Requests</option>
            <option value="change">Changes</option>
          </select>
          {loading && <span className="text-xs text-indigo-500 animate-pulse">Loading...</span>}
        </div>

        {/* KPI row */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {kpiCard('🎫', 'Total Tickets', summary.total, null, 'indigo')}
            {kpiCard('🔓', 'Open', summary.open, null, 'blue')}
            {kpiCard('⚠️', 'Overdue', summary.overdue, null, 'red')}
            {kpiCard('✅', 'Resolved Today', summary.resolved_today, null, 'green')}
            {kpiCard('⏱️', 'Avg Resolution', summary.avg_resolution_hours ? `${summary.avg_resolution_hours}h` : '—', 'time to resolve', 'teal')}
            {kpiCard('⚡', 'Avg First Reply', summary.avg_first_response_hours ? `${summary.avg_first_response_hours}h` : '—', 'first response time', 'amber')}
          </div>
        )}

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition rounded-t-lg ${activeTab === tab.key ? 'bg-white dark:bg-gray-800 border border-b-white dark:border-b-gray-800 border-gray-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── TICKETS TAB ── */}
        {activeTab === 'tickets' && (
          <div className="space-y-5">
            {/* Daily trend + Category */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="🗓️ Tickets Created Daily" height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} name="Tickets" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="📁 Tickets by Category" height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCategory.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" radius={[0,4,4,0]} name="Tickets" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Priority + Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="🚦 By Priority" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byPriority}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="priority" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4,4,0,0]} name="Tickets">
                      {byPriority.map((_, i) => <Cell key={i} fill={['#22c55e','#f59e0b','#ef4444','#7c3aed'][i] || '#6366f1'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="📊 By Status" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byStatus} dataKey="count" nameKey="status" outerRadius={80} label={({ status, percent }) => `${status} ${(percent*100).toFixed(0)}%`}>
                      {byStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Aging */}
            <ChartCard title="⏳ Open Ticket Aging" height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aging}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4,4,0,0]} name="Open Tickets">
                    {aging.map((_, i) => <Cell key={i} fill={['#22c55e','#6366f1','#f59e0b','#f97316','#ef4444'][i] || '#6366f1'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        {/* ── AGENTS TAB ── */}
        {activeTab === 'agents' && (
          <div className="space-y-5">
            {/* Resolution + FRT trends */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="⏱️ Avg Resolution Time (hours)" height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={resTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="avg_hours" stroke="#22c55e" strokeWidth={2} dot={false} name="Avg hours" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="⚡ Avg First Response Time (hours)" height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={frtTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="avg_hours" stroke="#f59e0b" strokeWidth={2} dot={false} name="Avg hours" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Agent workload table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="p-5 border-b border-gray-100 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">👥 Agent Workload</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      {['Agent','Assigned','Resolved','Resolution Rate','Hours Logged'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {agentWorkload.length === 0 && (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400 text-sm">No agent data</td></tr>
                    )}
                    {agentWorkload.map((a, i) => {
                      const rate = a.assigned > 0 ? Math.round((a.resolved / a.assigned) * 100) : 0;
                      return (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-5 py-4 text-sm font-medium text-gray-800 dark:text-white">{a.agent_name}</td>
                          <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{a.assigned}</td>
                          <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{a.resolved}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                                <div className="bg-indigo-500 h-1.5 rounded-full" style={{width: `${rate}%`}} />
                              </div>
                              <span className="text-xs text-gray-500">{rate}%</span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{a.total_hours}h</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── SLA TAB ── */}
        {activeTab === 'sla' && slaCompliance && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {kpiCard('✅', 'SLA Compliance', `${slaCompliance.compliance_percent}%`, `${slaCompliance.on_time} of ${slaCompliance.total_resolved} resolved on time`, slaCompliance.compliance_percent >= 90 ? 'green' : slaCompliance.compliance_percent >= 70 ? 'amber' : 'red')}
              {kpiCard('📋', 'Total Resolved', slaCompliance.total_resolved, 'in selected period', 'indigo')}
              {kpiCard('⏰', 'On Time', slaCompliance.on_time, 'resolved within SLA deadline', 'teal')}
            </div>
            <ChartCard title="📈 SLA Compliance Gauge" height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="60%" outerRadius="80%" data={[{ name: 'Compliance', value: slaCompliance.compliance_percent, fill: slaCompliance.compliance_percent >= 90 ? '#22c55e' : slaCompliance.compliance_percent >= 70 ? '#f59e0b' : '#ef4444' }]} startAngle={180} endAngle={0}>
                  <RadialBar dataKey="value" cornerRadius={10} background />
                  <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="text-3xl font-bold" fill={slaCompliance.compliance_percent >= 90 ? '#22c55e' : '#ef4444'} fontSize={36}>
                    {slaCompliance.compliance_percent}%
                  </text>
                  <text x="50%" y="68%" textAnchor="middle" fill="#9ca3af" fontSize={14}>SLA Compliance</text>
                </RadialBarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        {/* ── CSAT TAB ── */}
        {activeTab === 'csat' && (
          <div className="space-y-5">
            {csat && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {kpiCard('⭐', 'Avg CSAT Score', csat.avg_rating ? `${csat.avg_rating}/5` : '—', `${csat.total_responses} responses`, 'amber')}
                {kpiCard('😊', 'Satisfaction Rate', csat.satisfaction_rate ? `${csat.satisfaction_rate}%` : '—', 'rated 4 or 5 stars', 'green')}
                {kpiCard('📋', 'Total Responses', csat.total_responses, null, 'indigo')}
                {kpiCard('😞', 'Negative Ratings', csat.negative_count || 0, 'rated 1 or 2 stars', 'red')}
              </div>
            )}
            {csatTrend.length > 0 && (
              <ChartCard title="📈 CSAT Score Trend" height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={csatTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="avg_rating" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Avg Rating" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            {(!csat || csat.total_responses === 0) && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center border border-gray-100 dark:border-gray-700">
                <p className="text-4xl mb-3">⭐</p>
                <p className="text-gray-400">No CSAT responses yet in the selected period</p>
              </div>
            )}
          </div>
        )}

        {/* ── CHANGES TAB ── */}
        {activeTab === 'changes' && changesSummary && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpiCard('🔄', 'Total Changes', changesSummary.total, null, 'indigo')}
              {kpiCard('⏳', 'Open', changesSummary.open, 'pending or approved', 'amber')}
              {kpiCard('✅', 'Implemented', changesSummary.implemented, null, 'green')}
              {kpiCard('❌', 'Rejected', changesSummary.rejected, null, 'red')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="By Status" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={Object.entries(changesSummary.by_status || {}).map(([k,v]) => ({name:k,value:v}))} dataKey="value" nameKey="name" outerRadius={80} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>
                      {Object.keys(changesSummary.by_status || {}).map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="By Risk Level" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={Object.entries(changesSummary.by_risk || {}).map(([k,v]) => ({risk:k,count:v}))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="risk" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4,4,0,0]} name="Changes">
                      {Object.keys(changesSummary.by_risk || {}).map((_,i) => <Cell key={i} fill={['#22c55e','#f59e0b','#ef4444','#7c3aed'][i]||'#6366f1'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            {changesSummary.daily?.length > 0 && (
              <ChartCard title="Changes Created Daily" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={changesSummary.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Changes" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        )}

        {/* ── KB TAB ── */}
        {activeTab === 'kb' && kbAnalytics && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpiCard('📚', 'Total Articles', kbAnalytics.total_articles, null, 'indigo')}
              {kpiCard('👁️', 'Total Views', kbAnalytics.total_views, null, 'blue')}
              {kpiCard('👍', 'Satisfaction Rate', `${kbAnalytics.satisfaction_rate}%`, `${kbAnalytics.total_helpful} helpful, ${kbAnalytics.total_not_helpful} not`, 'green')}
              {kpiCard('📁', 'Categories', kbAnalytics.by_category?.length, null, 'teal')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="Views by Category" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={kbAnalytics.by_category} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip />
                    <Bar dataKey="views" fill="#6366f1" radius={[0,4,4,0]} name="Views" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">🔥 Most Viewed Articles</h4>
                <div className="space-y-2">
                  {kbAnalytics.most_viewed?.slice(0,8).map((a,i) => (
                    <div key={a.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400 w-5 text-xs">{i+1}.</span>
                      <span className="text-gray-700 dark:text-gray-300 flex-1 truncate">{a.title}</span>
                      <span className="text-xs text-indigo-500 ml-2">👁️ {a.views}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ASSETS TAB ── */}
        {activeTab === 'assets' && assetSummary && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpiCard('💻', 'Total Assets', assetSummary.total, null, 'indigo')}
              {kpiCard('⚠️', 'Expiring in 30d', assetSummary.expiring_30_days, null, 'red')}
              {kpiCard('💰', 'Total Cost', assetSummary.total_cost ? `$${assetSummary.total_cost.toLocaleString()}` : '$0', null, 'teal')}
              {kpiCard('📊', 'Asset Types', assetSummary.by_type?.length, null, 'blue')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="By Type" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={assetSummary.by_type} dataKey="count" nameKey="type" outerRadius={80} label={({type,percent})=>`${type} ${(percent*100).toFixed(0)}%`}>
                      {assetSummary.by_type?.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="By Status" height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={assetSummary.by_status}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4,4,0,0]} fill="#6366f1" name="Assets" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            {assetSummary.expiring_soon?.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5">
                <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3">⚠️ Expiring in 30 days</h4>
                <div className="space-y-1">
                  {assetSummary.expiring_soon.map(a => (
                    <div key={a.id} className="flex items-center justify-between text-sm">
                      <span className="text-red-700 dark:text-red-300">{a.name}</span>
                      <span className="text-xs text-red-500 font-mono">{a.expiry_date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
