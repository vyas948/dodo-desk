import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../utils/apiFetch';
import Layout from '../components/Layout';
import { formatId } from '../utils/ticketId';
import { API } from '../api';

const STATUS_COLORS = {
  pending_approval: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  approved:         'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected:         'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  in_progress:      'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed:        'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

const RISK_COLORS = {
  low:      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  medium:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function ChangeDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [change, setChange] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [decideId, setDecideId] = useState(null);  // approval id being decided
  const [decideComment, setDecideComment] = useState('');
  const [deciding, setDeciding] = useState(false);

  const refetch = () =>
    fetch(`${API}/changes/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json()).then(setChange);

  const fetchApprovals = () =>
    apiFetch(`/changes/${id}/approvals`, token)
      .then(data => setApprovals(Array.isArray(data) ? data : []))
      .catch(() => {});

  useEffect(() => {
    refetch();
    fetchApprovals();
  }, [id, token]);

  const handleDecide = async (approvalId, decision) => {
    if (decision === 'rejected' && !decideComment.trim()) {
      toast.error('Please provide a reason for rejection.');
      return;
    }
    setDeciding(true);
    try {
      await apiFetch(`/changes/${id}/approvals/${approvalId}/decide`, token, {
        method: 'POST',
        body: JSON.stringify({ decision, comment: decideComment }),
      });
      toast.success(decision === 'approved' ? '✅ Step approved.' : '❌ Change rejected.');
      setDecideId(null);
      setDecideComment('');
      refetch();
      fetchApprovals();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeciding(false);
    }
  };

  if (!change) return <Layout><div className="p-10 text-center text-gray-400">{t('common.loading')}</div></Layout>;

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";

  const pendingApproval = approvals.find(a =>
    a.status === 'pending' &&
    ((a.approver_id && a.approver_id === user?.id) ||
     (a.approver_role && a.approver_role === user?.role) ||
     user?.role === 'admin')
  );

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link to="/changes" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">← Back</Link>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color:'var(--text-primary)'}}>
            {formatId(change.id, 'change')} — {change.title}
          </h2>
        </div>

        {/* Main detail card */}
        <div className={cardClass}>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[change.status] || 'bg-gray-100 text-gray-700'}`}>
              {t(`change.${change.status}`)}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${RISK_COLORS[change.risk_level] || 'bg-gray-100 text-gray-700'}`}>
              {t(`change.${change.risk_level}`)} risk
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{t('ticket.requester')}</p>
              <p className="font-medium text-gray-800 dark:text-white">{change.requester_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{t('change.plannedDate')}</p>
              <p className="font-medium text-gray-800 dark:text-white">{change.planned_date ? new Date(change.planned_date).toLocaleDateString() : '—'}</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('common.description')}</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{change.description}</p>
          </div>
        </div>

        {/* Approval chain */}
        {approvals.length > 0 && (
          <div className={cardClass}>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-4">✅ Approval Chain</h3>
            <div className="space-y-3">
              {approvals.map((step, idx) => (
                <div key={step.id} className={`p-4 rounded-lg border ${
                  step.status === 'approved'  ? 'border-green-200 bg-green-50 dark:border-green-700 dark:bg-green-900/20' :
                  step.status === 'rejected'  ? 'border-red-200 bg-red-50 dark:border-red-700 dark:bg-red-900/20' :
                  step.status === 'pending'   ? 'border-indigo-200 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/20' :
                  step.status === 'waiting'   ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/20' :
                  'border-gray-200 bg-gray-50 dark:border-gray-700'
                }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-white">
                        Step {step.step_order}: {step.step_name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {step.approver_name || (step.approver_role ? `Any ${step.approver_role}` : 'Unassigned')}
                      </p>
                      {step.comment && (
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">"{step.comment}"</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        step.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-200' :
                        step.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-200' :
                        step.status === 'pending'  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-800 dark:text-indigo-200' :
                        step.status === 'skipped'  ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' :
                        'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                      }`}>
                        {step.status === 'waiting' ? '⏳ Waiting' :
                         step.status === 'pending' ? '🔔 Pending' :
                         step.status === 'approved' ? '✅ Approved' :
                         step.status === 'rejected' ? '❌ Rejected' :
                         step.status === 'skipped' ? '⏭ Skipped' : step.status}
                      </span>
                    </div>
                  </div>

                  {/* Approve/Reject buttons for the current pending step */}
                  {step.status === 'pending' && pendingApproval?.id === step.id && (
                    <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-700">
                      {decideId === step.id ? (
                        <div className="space-y-2">
                          <textarea rows={2} value={decideComment}
                                    onChange={e => setDecideComment(e.target.value)}
                                    placeholder="Comment (required for rejection)..."
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          <div className="flex gap-2">
                            <button onClick={() => handleDecide(step.id, 'approved')} disabled={deciding}
                                    className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-green-700 transition disabled:opacity-50">
                              ✅ Approve
                            </button>
                            <button onClick={() => handleDecide(step.id, 'rejected')} disabled={deciding}
                                    className="bg-red-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-red-700 transition disabled:opacity-50">
                              ❌ Reject
                            </button>
                            <button onClick={() => { setDecideId(null); setDecideComment(''); }}
                                    className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-1.5 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setDecideId(step.id)}
                                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
                          Make decision →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No workflow message for pending changes */}
        {approvals.length === 0 && change.status === 'pending_approval' && (user?.role === 'agent' || user?.role === 'admin') && (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-xl">
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-3">⏳ {t('change.approvalPending')}</p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3">No approval workflow configured for change requests. Using simple approve/reject.</p>
            <div className="flex gap-2">
              <button onClick={async () => {
                await fetch(`${API}/changes/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                refetch(); toast.success('Change approved.');
              }} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition">
                ✅ {t('approval.approve')}
              </button>
              <button onClick={async () => {
                const reason = prompt('Reason for rejection:');
                if (!reason) return;
                await fetch(`${API}/changes/${id}/reject`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ body: reason }),
                });
                refetch(); toast.success('Change rejected.');
              }} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition">
                ❌ {t('approval.reject')}
              </button>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
