import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import Layout from '../components/Layout';
import ExportMenu from '../components/ExportMenu';
import { useBranding } from '../contexts/BrandingContext';
import { API } from '../api';
import { useToast } from '../contexts/ToastContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

function SlaGauge({ percent }) {
  const safePercent = typeof percent === 'number' && !isNaN(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;

  // Semicircle gauge using stroke-dasharray on a circle
  // We only show the top half (180 degrees) as a gauge
  const R = 54;           // radius
  const cx = 80;          // center x
  const cy = 80;          // center y (bottom of viewBox)
  const circumference = Math.PI * R;   // half circle = πr
  const filled = (safePercent / 100) * circumference;
  const gap    = circumference - filled;

  // Color based on compliance level
  const color = safePercent >= 80 ? '#22c55e' : safePercent >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center w-full">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 font-medium">SLA Compliance</p>
      <div className="relative" style={{ width: 160, height: 90 }}>
        <svg width="160" height="90" viewBox="0 0 160 90">
          {/* Background track — grey semicircle */}
          <path
            d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="14"
            strokeLinecap="round"
            className="dark:stroke-gray-700"
          />
          {/* Filled arc — rotated so it starts from left */}
          {safePercent > 0 && (
            <path
              d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
              fill="none"
              stroke={color}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${gap}`}
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          )}
        </svg>
        {/* Percentage label centered in arc */}
        <div className="absolute inset-0 flex items-end justify-center pb-1">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">
            {safePercent.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Reports() {
  const { token } = useAuth();
  const branding = useBranding();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [byPriority, setByPriority] = useState([]);
  const [byStatus, setByStatus] = useState([]);
  const [daily, setDaily] = useState([]);
  const [workload, setWorkload] = useState([]);
  const [slaCompliance, setSlaCompliance] = useState(0);
  const [csat, setCsat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Detect dark mode for recharts (which can't read CSS variables directly)
  const darkMode = document.documentElement.classList.contains('dark');
  const chartTextColor = darkMode ? '#9ca3af' : '#6b7280';
  const chartGridColor = darkMode ? '#374151' : '#e5e7eb';
  const tooltipStyle = darkMode
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#e5e7eb' }
    : { backgroundColor: '#fff', border: '1px solid #e5e7eb', color: '#111827' };

  const fetchMainData = async () => {
    const base = `${API}/reports`;
    const headers = { Authorization: `Bearer ${token}` };
    let query = '';
    if (filterType !== 'all') query += `&ticket_type=${filterType}`;
    if (startDate) query += `&start_date=${startDate}`;
    if (endDate) query += `&end_date=${endDate}`;
    query = query.replace(/^&/, '?');

    const safeFetch = async (url) => {
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    };

    try {
      const [summaryRes, priorityRes, statusRes, dailyRes, workloadRes, slaRes] = await Promise.all([
        safeFetch(`${base}/summary${query}`),
        safeFetch(`${base}/tickets-by-priority${query}`),
        safeFetch(`${base}/tickets-by-status${query}`),
        safeFetch(`${base}/tickets-created-daily${query}`),
        safeFetch(`${base}/agent-workload${query}`),
        safeFetch(`${base}/sla-compliance${query}`),
      ]);

      if (summaryRes) setSummary(summaryRes);
      if (priorityRes) setByPriority(priorityRes);
      if (statusRes) setByStatus(statusRes);
      if (dailyRes) setDaily(dailyRes);
      if (workloadRes) setWorkload(workloadRes);
      const comp = typeof slaRes?.compliance_percent === 'number' ? slaRes.compliance_percent : 0;
      setSlaCompliance(comp);
    } catch (err) {
      toast.error('Failed to load reports. Please try again.');
    }
  };

  const fetchCsat = async () => {
    try {
      const res = await fetch(`${API}/reports/csat`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setCsat(await res.json());
    } catch (err) {
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchMainData();
      await fetchCsat();
      setLoading(false);
    };
    load();
  }, [token, filterType, startDate, endDate]);

  const getReportExportData = async () => {
    let query = '';
    if (filterType !== 'all') query += `&ticket_type=${filterType}`;
    if (startDate) query += `&start_date=${startDate}`;
    if (endDate) query += `&end_date=${endDate}`;
    query = query.replace(/^&/, '?');

    const res = await fetch(`${API}/reports/export/csv${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch report data');
    const text = await res.text();

    // Parse CSV (handles quoted fields with embedded commas)
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.length > 0);
    const parseLine = (line) => {
      const result = [];
      let cur = '', inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') inQuotes = false;
          else cur += ch;
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ',') { result.push(cur); cur = ''; }
          else cur += ch;
        }
      }
      result.push(cur);
      return result;
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4";
  const inputClass = "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const chartCardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const chartTitleClass = "text-lg font-semibold text-gray-800 dark:text-white mb-4";

  if (loading) {
    return <Layout><div className="text-center py-10 text-gray-400 dark:text-gray-500">{t('common.loading')}</div></Layout>;
  }

  return (
    <Layout>
      {/* Header + filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('reports.title')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500 dark:text-gray-400">{t('reports.from')}:</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputClass} />
            <label className="text-sm text-gray-500 dark:text-gray-400">{t('reports.to')}:</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputClass} />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className={inputClass}>
            <option value="all">{t('reports.allTickets')}</option>
            <option value="incident">{t('reports.incidentsOnly')}</option>
            <option value="service_request">{t('reports.serviceRequestsOnly')}</option>
            <option value="change">{t('reports.changeRequestsOnly') || 'Change Requests'}</option>
          </select>
          <ExportMenu
            getData={getReportExportData}
            filename={`dodesk-report-${new Date().toISOString().slice(0, 10)}`}
            title="Ticket Report"
            branding={branding}
            label={t('common.export') || 'Export'}
          />
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <Link to="/" className={`${cardClass} hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-all`} title="View all tickets">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('reports.total')}</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{summary.total}</p>
            <p className="text-xs text-indigo-400 mt-1">View all →</p>
          </Link>
          <Link to="/?filter=unassigned" className={`${cardClass} hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-all`} title="View unassigned tickets">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('reports.unassigned')}</p>
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{summary.open}</p>
            <p className="text-xs text-indigo-400 mt-1">View unassigned →</p>
          </Link>
          <Link to="/?filter=overdue" className={`${cardClass} hover:shadow-md hover:border-red-200 dark:hover:border-red-700 transition-all`} title="View overdue tickets">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('reports.overdue')}</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{summary.overdue}</p>
            <p className="text-xs text-red-400 mt-1">View overdue →</p>
          </Link>
          <div className={cardClass}>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('reports.resolvedToday')}</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.resolved_today}</p>
          </div>
          <div className={cardClass}>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('reports.avgResolution')}</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{summary.avg_resolution_hours}h</p>
          </div>
          <div className={`${cardClass} flex items-center justify-center overflow-hidden min-h-[220px]`}>
            <SlaGauge percent={slaCompliance} />
          </div>
          {csat && (
            <div className={cardClass}>
              <p className="text-sm text-gray-500 dark:text-gray-400">CSAT</p>
              {csat.average !== null ? (
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{csat.average}/5</p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">No ratings yet</p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500">{csat.count} responses</p>
            </div>
          )}
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className={chartCardClass}>
          <h3 className={chartTitleClass}>{t('reports.ticketsByPriority')}</h3>
          {byPriority.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byPriority}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="priority" tick={{ fill: chartTextColor }} />
                <YAxis allowDecimals={false} tick={{ fill: chartTextColor }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 dark:text-gray-500 text-sm">No data</p>
          )}
        </div>

        <div className={chartCardClass}>
          <h3 className={chartTitleClass}>{t('reports.ticketsByStatus')}</h3>
          {byStatus.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={100} label>
                  {byStatus.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ color: chartTextColor }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 dark:text-gray-500 text-sm">No data</p>
          )}
        </div>
      </div>

      {/* Daily trend */}
      <div className={`${chartCardClass} mb-8`}>
        <h3 className={chartTitleClass}>{t('reports.ticketsCreated')}</h3>
        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
              <XAxis dataKey="date" tick={{ fill: chartTextColor }} />
              <YAxis allowDecimals={false} tick={{ fill: chartTextColor }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-400 dark:text-gray-500 text-sm">No data</p>
        )}
      </div>

      {/* Agent workload */}
      <div className={chartCardClass}>
        <h3 className={chartTitleClass}>{t('reports.agentWorkload')}</h3>
        {workload.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.agent') || 'Agent'}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.assignedTo') || 'Assigned'}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('ticket.resolved') || 'Resolved'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {workload.map(w => (
                  <tr key={w.agent_name} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 text-sm font-medium text-gray-800 dark:text-white">{w.agent_name}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{w.assigned}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{w.resolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 dark:text-gray-500 text-sm">No data</p>
        )}
      </div>
    </Layout>
  );
}
