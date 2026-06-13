import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { API } from '../api';
import { formatId } from '../utils/ticketId';

const icons = {
  paperclip: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  ),
  send: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
  ),
};

export default function TicketDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [justification, setJustification] = useState('');
  const [assets, setAssets] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [cannedResponses, setCannedResponses] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [showAudit, setShowAudit] = useState(false);
  const [approvals, setApprovals] = useState([]);
  const [approvalComment, setApprovalComment] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    fetchTicket();
    fetchComments();
    fetchAssets();
    fetchCannedResponses();
    fetchAttachments();
    fetchAuditLog();
    fetchApprovals();
  }, [id, token]);

  const fetchApprovals = () => {
    apiFetch(`/tickets/${id}/approvals`, token)
      .then(data => setApprovals(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const fetchTicket = () => {
    fetch(`${API}/tickets/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setTicket(data); setStatus(data.status); setSelectedAssetId(data.asset_id ? data.asset_id.toString() : ''); })
      .catch(console.error);
  };
  const fetchComments = () => {
    fetch(`${API}/tickets/${id}/comments`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json()).then(setComments).catch(console.error);
  };
  const fetchAssets = () => {
    fetch(`${API}/assets/?limit=200`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAssets(data.items ?? []))
      .catch(console.error);
  };
  const fetchCannedResponses = () => {
    fetch(`${API}/canned-responses/?limit=200`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setCannedResponses(data.items ?? []))
      .catch(console.error);
  };
  const fetchAttachments = () => {
    fetch(`${API}/tickets/${id}/attachments`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json()).then(setAttachments).catch(console.error);
  };

  const fetchAuditLog = () => {
    apiFetch(`/tickets/${id}/audit-log`, token)
      .then(data => setAuditLog(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const handleSubmitComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const res = await fetch(`${API}/tickets/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: newComment }),
      });
      if (!res.ok) throw new Error('Failed to add comment');
      const added = await res.json();
      setComments([...comments, added]);
      setNewComment('');
      setError('');
    } catch (err) { setError(err.message); }
  };

  const handleSaveStatus = async () => {
    try {
      const patchRes = await fetch(`${API}/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (!patchRes.ok) throw new Error('Failed to update status');
      if (justification.trim()) {
        await fetch(`${API}/tickets/${id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ body: justification }),
        });
        setJustification('');
        fetchComments();
      }
      fetchTicket();
      toast.success('Status updated successfully.');
    } catch (err) { setError(err.message); }
  };

  const handleAssignToMe = async () => {
    const resMe = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    const me = await resMe.json();
    await fetch(`${API}/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ assigned_to_id: me.id }),
    });
    fetchTicket();
  };
  const handleUnassign = async () => {
    await fetch(`${API}/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ assigned_to_id: null }),
    });
    fetchTicket();
  };
  const handleLinkAsset = async (assetId) => {
    const body = assetId ? { asset_id: parseInt(assetId) } : { asset_id: null };
    await fetch(`${API}/tickets/${id}/link-asset`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    fetchTicket();
  };
  const handleApprove = async () => {
    await fetch(`${API}/tickets/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    fetchTicket();
  };
  const handleReject = async () => {
    const reason = prompt(t('approval.reason'));
    if (!reason) return;
    await fetch(`${API}/tickets/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: reason }),
    });
    fetchTicket(); fetchComments();
  };

  const handleWorkflowDecision = async (approvalId, decision) => {
    if (decision === 'rejected' && !approvalComment.trim()) {
      toast.error('Please enter a reason for rejection.');
      return;
    }
    try {
      await apiFetch(`/tickets/${id}/approvals/${approvalId}/decide`, token, {
        method: 'POST',
        body: JSON.stringify({ decision, comment: approvalComment }),
      });
      toast.success(decision === 'approved' ? 'Step approved.' : 'Request rejected.');
      setApprovalComment('');
      fetchTicket();
      fetchApprovals();
      fetchAuditLog();
    } catch (err) { toast.error(err.message); }
  };

  if (!ticket) return <Layout><div className="p-10 text-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div></Layout>;

  // Dark mode classes
  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const detailCardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const labelClass = "text-xs text-gray-500 dark:text-gray-400 block mb-1";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const selectClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const btnPrimary = "bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";
  const conversationItemClass = "flex-1 bg-gray-50 dark:bg-gray-700 rounded-lg p-4";
  const avatarClass = "flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-sm font-medium";

  return (
    <Layout>
      <div className="mb-4">
        <Link to="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400">{t('ticket.breadcrumb')}</Link>
        <span className="mx-2 text-gray-400 dark:text-gray-600">/</span>
        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{formatId(ticket.id, ticket.ticket_type)}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          <div className={cardClass}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900 px-2 py-0.5 rounded">
                    {ticket.ticket_type === 'incident' ? 'INC' : ticket.ticket_type === 'service_request' ? 'REQ' : 'CHG'}{String(ticket.id).padStart(6, '0')}
                  </span>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">{ticket.title}</h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${ticket.ticket_type === 'incident' ? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300'}`}>
                    {ticket.ticket_type === 'incident' ? t('ticket.incident') : t('ticket.serviceRequest')}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    ticket.priority === 'critical' ? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300' :
                    ticket.priority === 'high' ? 'bg-orange-50 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
                    ticket.priority === 'medium' ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                    'bg-gray-50 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {t(`ticket.${ticket.priority}`)}
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('ticket.reportedBy')} <span className="font-medium text-gray-700 dark:text-gray-200">{ticket.requester_name}</span> {t('ticket.on')} {new Date(ticket.created_at).toLocaleDateString()} · {ticket.category || t('common.general')}
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                ticket.status === 'open' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                ticket.status === 'in_progress' ? 'bg-purple-50 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
                ticket.status === 'resolved' ? 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300' :
                ticket.status === 'closed' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' :
                'bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
              }`}>
                {t(`ticket.${ticket.status}`)}
              </span>
            </div>

            {/* SLA alert */}
            {ticket.sla_status !== 'ok' && (
              <div className={`p-3 rounded-lg mb-4 text-sm flex items-center gap-2 ${
                ticket.sla_status === 'overdue' ? 'bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700' :
                'bg-yellow-50 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700'
              }`}>
                {ticket.sla_status === 'overdue' ? '⚠ ' + t('dashboard.overdue') + ' – ' + t('ticket.slaResolution') : '⚡ ' + t('ticket.slaResponse')}
              </div>
            )}

            {/* Description */}
            <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300 border-l-4 border-indigo-200 dark:border-indigo-700 pl-4 italic">
              {ticket.description}
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('ticket.attachments')}</h4>
                <div className="flex flex-wrap gap-2">
                  {attachments.map(att => (
                    <a key={att.id} href={`${API}/attachments/${att.id}/download`}
                       className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900 hover:border-indigo-200 transition"
                       target="_blank" rel="noopener noreferrer">
                      {icons.paperclip} {att.filename}
                      <span className="text-xs text-gray-400 dark:text-gray-500">({(att.size / 1024).toFixed(0)} KB)</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Conversation */}
          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">{t('ticket.conversation')}</h3>
            {comments.length === 0 ? (
              <p className="text-gray-400 dark:text-gray-500 text-sm italic">{t('ticket.noComments')}</p>
            ) : (
              <div className="space-y-4">
                {comments.map(c => (
                  <div key={c.id} className="flex gap-3">
                    <div className={avatarClass}>{c.author_name.charAt(0).toUpperCase()}</div>
                    <div className={conversationItemClass}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-medium text-sm text-gray-800 dark:text-white">{c.author_name}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Reply form */}
            <div className="mt-6 border-t border-gray-100 dark:border-gray-700 pt-4">
              <form onSubmit={handleSubmitComment} className="space-y-3">
                {user?.role === 'agent' && cannedResponses.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('common.cannedResponses')}:</label>
                    <select onChange={(e) => { const selected = cannedResponses.find(r => r.id === parseInt(e.target.value)); if (selected) setNewComment(selected.content); }}
                            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-700 dark:text-white" defaultValue="">
                      <option value="" disabled>{t('common.select')}...</option>
                      {cannedResponses.map(r => (<option key={r.id} value={r.id}>{r.title}</option>))}
                    </select>
                  </div>
                )}
                <div className="relative">
                  <textarea rows={3} value={newComment} onChange={e => setNewComment(e.target.value)}
                            placeholder={t('ticket.reply')}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-3 pr-12 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 resize-none" />
                  <button type="submit" className="absolute bottom-3 right-3 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300">
                    {icons.send}
                  </button>
                </div>
                {error && <p className="text-red-500 text-xs">{error}</p>}
              </form>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Success notification */}
          {successMsg && (
            <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg text-sm">
              {successMsg}
            </div>
          )}

          {/* Details card */}
          <div className={detailCardClass}>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t('ticket.details')}</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.status')}</span><span className="font-medium capitalize text-gray-900 dark:text-white">{t(`ticket.${ticket.status}`)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.priority')}</span><span className="font-medium capitalize text-gray-900 dark:text-white">{t(`ticket.${ticket.priority}`)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.requester')}</span><span className="text-gray-900 dark:text-white">{ticket.requester_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.category')}</span><span className="text-gray-900 dark:text-white">{ticket.category || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.created')}</span><span className="text-gray-900 dark:text-white">{new Date(ticket.created_at).toLocaleDateString()}</span></div>
              {ticket.sla_response_deadline && (
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.slaResponse')}</span><span className={ticket.sla_status === 'warning' ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-white'}>{new Date(ticket.sla_response_deadline).toLocaleString()}</span></div>
              )}
              {ticket.sla_resolution_deadline && (
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.slaResolution')}</span><span className={ticket.sla_status === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}>{new Date(ticket.sla_resolution_deadline).toLocaleString()}</span></div>
              )}
            </div>
          </div>

          {/* Agent & Admin Actions */}
          {(user?.role === 'agent' || user?.role === 'admin') && ticket.status !== 'pending_approval' && (
            <div className={detailCardClass + " space-y-4"}>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('common.actions')}</h3>

              <div>
                <label className={labelClass}>{t('ticket.changeStatus')}</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={selectClass + " mb-2"}>
                  <option value="open">{t('ticket.open')}</option>
                  <option value="in_progress">{t('ticket.inProgress')}</option>
                  <option value="resolved">{t('ticket.resolved')}</option>
                  <option value="closed">{t('ticket.closed')}</option>
                </select>
                <textarea value={justification} onChange={e => setJustification(e.target.value)}
                          placeholder="Reason for status change (optional)..." className={inputClass + " resize-none"} rows={2} />
                <button onClick={handleSaveStatus} className={btnPrimary + " mt-2 w-full"}>
                  Save Status
                </button>
              </div>

              <div className="flex gap-2">
                {ticket.assigned_to_id === user.id ? (
                  <button disabled className="flex-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-3 py-2 rounded-lg text-sm font-medium cursor-not-allowed">
                    Assigned to me
                  </button>
                ) : (
                  <button onClick={handleAssignToMe} className={btnPrimary + " flex-1"}>
                    {t('ticket.assignToMe')}
                  </button>
                )}
                {ticket.assigned_to_id && (
                  <button onClick={handleUnassign} className={btnSecondary}>{t('ticket.unassign')}</button>
                )}
              </div>

              <div>
                <label className={labelClass}>{t('asset.linkAsset')}</label>
                <select value={selectedAssetId} onChange={e => setSelectedAssetId(e.target.value)} className={selectClass}>
                  <option value="">{t('common.none')}</option>
                  {assets.map(a => (<option key={a.id} value={a.id}>{a.name} ({a.type})</option>))}
                </select>
                <button onClick={() => handleLinkAsset(selectedAssetId)} className={btnSecondary + " mt-2 w-full"}>
                  {t('asset.updateAssetLink')}
                </button>
              </div>
            </div>
          )}

          {/* Approval actions */}
          {(user?.role === 'agent' || user?.role === 'admin') && ticket.status === 'pending_approval' && (
            <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-xl p-5 space-y-3">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{t('ticket.awaitingApproval')}</p>
              <div className="flex gap-2">
                <button onClick={handleApprove} className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">{t('approval.approve')}</button>
                <button onClick={handleReject} className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">{t('approval.reject')}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Approval Chain */}
      {approvals.length > 0 && (
        <div className="max-w-5xl mx-auto mt-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">
              ✅ Approval Chain ({approvals.filter(a => a.status === 'approved').length}/{approvals.length} steps completed)
            </h3>

            {/* Steps progress */}
            <div className="space-y-3 mb-4">
              {approvals.map((approval, i) => {
                const statusColors = {
                  approved: 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-700',
                  rejected: 'bg-red-100 dark:bg-red-900 border-red-300 dark:border-red-700',
                  pending: 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-700',
                  waiting: 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600',
                  skipped: 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600',
                };
                const statusIcons = { approved: '✅', rejected: '❌', pending: '⏳', waiting: '⏸', skipped: '⏭' };
                const isCurrentApprover = approval.status === 'pending' && (
                  approval.approver_id === user?.id ||
                  (approval.approver_role && approval.approver_role === user?.role)
                );
                const canDecide = isCurrentApprover || user?.role === 'admin';

                return (
                  <div key={approval.id} className={`rounded-lg border p-4 ${statusColors[approval.status] || ''}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{statusIcons[approval.status]}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-white">
                            Step {approval.step_order}: {approval.step_name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {approval.approver_name ? `Approver: ${approval.approver_name}` : approval.approver_role ? `Any ${approval.approver_role}` : ''}
                            {approval.decided_at && ` · ${new Date(approval.decided_at).toLocaleString()}`}
                          </p>
                          {approval.comment && (
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">"{approval.comment}"</p>
                          )}
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        approval.status === 'approved' ? 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200' :
                        approval.status === 'rejected' ? 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200' :
                        approval.status === 'pending' ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200' :
                        'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                      }`}>
                        {approval.status}
                      </span>
                    </div>

                    {/* Decision buttons for current approver */}
                    {canDecide && approval.status === 'pending' && (
                      <div className="mt-3 space-y-2">
                        <textarea
                          value={approvalComment}
                          onChange={e => setApprovalComment(e.target.value)}
                          placeholder="Optional comment (required for rejection)..."
                          rows={2}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleWorkflowDecision(approval.id, 'approved')}
                                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition">
                            ✅ Approve
                          </button>
                          <button onClick={() => handleWorkflowDecision(approval.id, 'rejected')}
                                  className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition">
                            ❌ Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Audit Log */}
      {auditLog.length > 0 && (
        <div className="max-w-5xl mx-auto mt-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            <button
              onClick={() => setShowAudit(prev => !prev)}
              className="w-full flex items-center justify-between p-5 text-left"
            >
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                🕐 Audit Log ({auditLog.length} events)
              </h3>
              <span className="text-gray-400 dark:text-gray-500 text-sm">{showAudit ? '▲ Hide' : '▼ Show'}</span>
            </button>

            {showAudit && (
              <div className="px-5 pb-5">
                <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-3 space-y-4">
                  {auditLog.map(entry => (
                    <li key={entry.id} className="ml-6">
                      <span className="absolute -left-2.5 flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900 ring-4 ring-white dark:ring-gray-800">
                        <span className="text-xs">{
                          entry.action === 'created' ? '✚' :
                          entry.action === 'status_changed' ? '🔄' :
                          entry.action === 'assigned' ? '👤' :
                          entry.action === 'comment_added' ? '💬' :
                          entry.action === 'approved' ? '✅' :
                          entry.action === 'rejected' ? '❌' : '•'
                        }</span>
                      </span>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            {entry.actor_name}
                          </span>
                          <time className="text-xs text-gray-400 dark:text-gray-500">
                            {new Date(entry.created_at).toLocaleString()}
                          </time>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          {entry.action === 'created' && 'Ticket created'}
                          {entry.action === 'status_changed' && (
                            <>Status changed from <span className="font-medium">{t(`ticket.${entry.old_value}`) || entry.old_value}</span> to <span className="font-medium">{t(`ticket.${entry.new_value}`) || entry.new_value}</span></>
                          )}
                          {entry.action === 'assigned' && (
                            <>Assigned from <span className="font-medium">{entry.old_value}</span> to <span className="font-medium">{entry.new_value}</span></>
                          )}
                          {entry.action === 'comment_added' && 'Comment added'}
                          {entry.action === 'approved' && 'Ticket approved'}
                          {entry.action === 'rejected' && 'Ticket rejected'}
                        </p>
                        {entry.note && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">"{entry.note}"</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}