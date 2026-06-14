import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { formatId } from '../utils/ticketId';
import { API } from '../api';

export default function ChangeDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [change, setChange] = useState(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const refetch = () =>
    fetch(`${API}/changes/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setChange);

  useEffect(() => { refetch(); }, [id, token]);

  const handleApprove = async () => {
    await fetch(`${API}/changes/${id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    refetch();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setRejectError(t('approval.reasonRequired')); return; }
    await fetch(`${API}/changes/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: rejectReason }),
    });
    setShowRejectForm(false);
    setRejectReason('');
    setRejectError('');
    refetch();
  };

  if (!change) return <Layout><div className="p-10 text-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div></Layout>;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4" style={{color: "var(--text-primary)"}}>{formatId(change.id, 'change')} – {change.title}</h2>

        {(user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && change.status === 'pending_approval' && (
          <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-xl space-y-3">
            <p className="font-semibold text-yellow-800 dark:text-yellow-200">{t('change.approvalPending')}</p>

            {!showRejectForm ? (
              <div className="flex gap-2">
                <button onClick={handleApprove}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 transition">
                  {t('approval.approve')}
                </button>
                <button onClick={() => setShowRejectForm(true)}
                        className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition">
                  {t('approval.reject')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  {t('approval.reason')}
                </label>
                <textarea
                  value={rejectReason}
                  onChange={e => { setRejectReason(e.target.value); setRejectError(''); }}
                  rows={3}
                  className="w-full border border-yellow-300 dark:border-yellow-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder={t('approval.reasonPlaceholder')}
                />
                {rejectError && <p className="text-red-600 dark:text-red-400 text-xs">{rejectError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleReject}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition">
                    {t('approval.confirmReject')}
                  </button>
                  <button onClick={() => { setShowRejectForm(false); setRejectReason(''); setRejectError(''); }}
                          className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition">
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div><strong className="text-gray-800 dark:text-white">{t('change.riskLevel')}:</strong> <span className="text-gray-700 dark:text-gray-300">{t(`change.${change.risk_level}`)}</span></div>
          <div><strong className="text-gray-800 dark:text-white">{t('common.status')}:</strong> <span className="text-gray-700 dark:text-gray-300">{t(`change.${change.status}`)}</span></div>
          <div><strong className="text-gray-800 dark:text-white">{t('ticket.requester')}:</strong> <span className="text-gray-700 dark:text-gray-300">{change.requester_name}</span></div>
          <div><strong className="text-gray-800 dark:text-white">{t('change.plannedDate')}:</strong> <span className="text-gray-700 dark:text-gray-300">{change.planned_date ? new Date(change.planned_date).toLocaleDateString() : '—'}</span></div>
        </div>
        <p className="mb-4 text-gray-700 dark:text-gray-300"><strong className="text-gray-800 dark:text-white">{t('common.description')}:</strong> {change.description}</p>
        <Link to="/changes" className="text-indigo-600 dark:text-indigo-400 hover:underline">{t('change.backToChanges')}</Link>
      </div>
    </Layout>
  );
}
