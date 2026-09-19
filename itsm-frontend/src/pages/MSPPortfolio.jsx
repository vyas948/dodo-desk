import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

function riskLabel(row, t) {
  if (row.risk_score >= 15) return { emoji: '🔴', text: t('mspPortfolio.needsAttention'), className: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
  if (row.risk_score >= 6) return { emoji: '🟡', text: t('mspPortfolio.watch'), className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
  return { emoji: '🟢', text: t('mspPortfolio.healthy'), className: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
}

export default function MSPPortfolio() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiFetch('/msp/portfolio-summary', token)
      .then(data => { setRows(Array.isArray(data) ? data : []); setForbidden(false); })
      .catch(err => {
        if (err.message && err.message.toLowerCase().includes('permission')) setForbidden(true);
        else toast.error(err.message);
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">🏢 {t('mspPortfolio.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('mspPortfolio.pageDesc')}
          </p>
        </div>

        {forbidden ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-gray-500 dark:text-gray-400">{t('mspPortfolio.forbidden')}</p>
          </div>
        ) : loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-gray-400">{t('common.loading')}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-gray-400 text-sm">{t('mspPortfolio.noClients')}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('mspPortfolio.colClient')}</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.status')}</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('mspPortfolio.colOpenTickets')}</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('mspPortfolio.colOverdue')}</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('mspPortfolio.colVolume')}</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('mspPortfolio.colSlaCompliance')}</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('mspPortfolio.colExpiringAssets')}</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map(row => {
                    const risk = riskLabel(row, t);
                    return (
                      <tr key={row.tenant_id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-5 py-4 text-sm font-medium text-gray-800 dark:text-white">
                          {row.tenant_name}
                          <span className="block text-xs text-gray-400 font-normal capitalize">{row.plan} {t('mspPortfolio.planSuffix')}</span>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${risk.className}`}>{risk.emoji} {risk.text}</span>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{row.open_tickets}</td>
                        <td className="px-5 py-4 text-sm">
                          <span className={row.overdue_tickets > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-400'}>{row.overdue_tickets}</span>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                          {row.tickets_last_30d}
                          {row.volume_delta_pct !== 0 && (
                            <span className={`ml-1 text-xs ${row.volume_delta_pct > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                              ({row.volume_delta_pct > 0 ? '+' : ''}{row.volume_delta_pct}%)
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-sm">
                          {row.sla_compliance_pct === null
                            ? <span className="text-gray-400">—</span>
                            : <span className={row.sla_compliance_pct < 80 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-300'}>{row.sla_compliance_pct}%</span>}
                        </td>
                        <td className="px-5 py-4 text-sm">
                          <span className={row.expiring_or_expired_assets > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-400'}>{row.expiring_or_expired_assets}</span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Link to={`/reports?client_tenant_id=${row.tenant_id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">{t('mspPortfolio.viewReports')}</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
