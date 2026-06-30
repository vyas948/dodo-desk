import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { formatId } from '../utils/ticketId';

const TYPE_BADGE = {
  normal:    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  standard:  'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  emergency: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};
const RISK_BADGE = {
  low:      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  medium:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  high:     'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  critical: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-200',
};
const STATUS_BADGE = {
  draft:            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  in_review:        'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  approved:         'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  scheduled:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  in_progress:      'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  implemented:      'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  rejected:         'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  cancelled:        'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  failed:           'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-200',
};
const ALL_STATUSES = ['draft','pending_approval','in_review','approved','scheduled','in_progress','implemented','rejected','cancelled','failed'];
const inp = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

export default function ChangeDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);
  const canApprove = ['admin','super_admin'].includes(user?.role);

  const [change, setChange]           = useState(null);
  const [tasks, setTasks]             = useState([]);
  const [comments, setComments]       = useState([]);
  const [agents, setAgents]           = useState([]);
  const [editing, setEditing]         = useState(false);
  const [form, setForm]               = useState({});
  const [saving, setSaving]           = useState(false);
  const [newTask, setNewTask]         = useState('');
  const [newComment, setNewComment]   = useState('');
  const [isInternal, setIsInternal]   = useState(false);
  const [postReview, setPostReview]   = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [activeTab, setActiveTab]     = useState('details');

  const fetchAll = async () => {
    try {
      const [c, tk, cm] = await Promise.all([
        apiFetch(`/changes/${id}`, token),
        apiFetch(`/changes/${id}/tasks`, token),
        apiFetch(`/changes/${id}/comments`, token),
      ]);
      setChange(c);
      setTasks(Array.isArray(tk) ? tk : []);
      setComments(Array.isArray(cm) ? cm : []);
      setForm({
        title: c.title, description: c.description,
        change_type: c.change_type || 'normal',
        risk_level: c.risk_level || 'medium',
        risk_score: c.risk_score || '',
        status: c.status,
        planned_date: c.planned_date || '',
        start_date: c.start_date ? c.start_date.slice(0,16) : '',
        end_date: c.end_date ? c.end_date.slice(0,16) : '',
        impact: c.impact || '',
        rollback_plan: c.rollback_plan || '',
        test_plan: c.test_plan || '',
        owner_id: c.owner_id || '',
        assigned_to_id: c.assigned_to_id || '',
        cab_members: c.cab_members || [],
        linked_ticket_ids: (c.linked_ticket_ids || []).join(', '),
        linked_asset_ids: (c.linked_asset_ids || []).join(', '),
      });
      setPostReview(c.post_review_notes || '');
    } catch(e) { toast.error(e.message); }
  };

  useEffect(() => {
    fetchAll();
    if (isAgentOrAdmin) {
      apiFetch('/users/', token).then(d => setAgents(Array.isArray(d) ? d : (d.items ?? []))).catch(() => {});
    }
  }, [id, token]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...form,
        risk_score: form.risk_score ? parseInt(form.risk_score) : null,
        owner_id: form.owner_id ? parseInt(form.owner_id) : null,
        assigned_to_id: form.assigned_to_id ? parseInt(form.assigned_to_id) : null,
        linked_ticket_ids: form.linked_ticket_ids ? form.linked_ticket_ids.split(',').map(x => parseInt(x.trim())).filter(Boolean) : [],
        linked_asset_ids: form.linked_asset_ids ? form.linked_asset_ids.split(',').map(x => parseInt(x.trim())).filter(Boolean) : [],
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      await apiFetch(`/changes/${id}`, token, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success('Change saved');
      setEditing(false);
      fetchAll();
    } catch(e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleApprove = async () => {
    try { await apiFetch(`/changes/${id}/approve`, token, { method: 'POST' }); fetchAll(); toast.success('Change approved'); } catch(e) { toast.error(e.message); }
  };
  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    try { await apiFetch(`/changes/${id}/reject`, token, { method: 'POST', body: JSON.stringify({ body: rejectReason }) }); setShowRejectForm(false); fetchAll(); toast.success('Change rejected'); } catch(e) { toast.error(e.message); }
  };
  const [submitting, setSubmitting] = useState(false);
  const handleSubmitForApproval = async () => {
    setSubmitting(true);
    try {
      const updated = await apiFetch(`/changes/${id}/submit`, token, { method: 'POST' });
      fetchAll();
      toast.success(updated.status === 'approved' ? 'Standard change auto-approved' : 'Submitted for approval');
    } catch(e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const handleAddTask = async () => {
    if (!newTask.trim()) return;
    try { await apiFetch(`/changes/${id}/tasks`, token, { method: 'POST', body: JSON.stringify({ title: newTask }) }); setNewTask(''); fetchAll(); } catch(e) { toast.error(e.message); }
  };
  const handleToggleTask = async (task) => {
    try { await apiFetch(`/changes/${id}/tasks/${task.id}`, token, { method: 'PATCH', body: JSON.stringify({ is_done: !task.is_done }) }); fetchAll(); } catch(e) { toast.error(e.message); }
  };
  const handleDeleteTask = async (taskId) => {
    try { await apiFetch(`/changes/${id}/tasks/${taskId}`, token, { method: 'DELETE' }); fetchAll(); } catch(e) { toast.error(e.message); }
  };
  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try { await apiFetch(`/changes/${id}/comments`, token, { method: 'POST', body: JSON.stringify({ body: newComment, is_internal: isInternal }) }); setNewComment(''); fetchAll(); } catch(e) { toast.error(e.message); }
  };
  const handleSavePostReview = async () => {
    try { await apiFetch(`/changes/${id}`, token, { method: 'PATCH', body: JSON.stringify({ post_review_notes: postReview }) }); toast.success('Review saved'); fetchAll(); } catch(e) { toast.error(e.message); }
  };

  if (!change) return <Layout><div className="p-10 text-center text-gray-400">{t('common.loading')}</div></Layout>;

  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className={card}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-mono text-gray-400">{formatId(change.id, 'change')}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase ${TYPE_BADGE[change.change_type] || TYPE_BADGE.normal}`}>{change.change_type}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_BADGE[change.risk_level] || ''}`}>⚠️ {change.risk_level} risk{change.risk_score ? ` (score: ${change.risk_score})` : ''}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[change.status] || ''}`}>{change.status?.replace(/_/g,' ')}</span>
              </div>
              {editing ? (
                <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className={inp + " text-lg font-bold mb-2"} />
              ) : (
                <h2 className="text-xl font-bold text-gray-800 dark:text-white">{change.title}</h2>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-400 mt-1 flex-wrap">
                <span>By {change.requester_name}</span>
                {change.owner_name && <span>· Owner: {change.owner_name}</span>}
                {change.assigned_to_name && <span>· Assigned: {change.assigned_to_name}</span>}
                <span>· {new Date(change.created_at).toLocaleDateString()}</span>
              </div>
            </div>
            {isAgentOrAdmin && (
              <div className="flex gap-2 flex-shrink-0">
                {!editing ? (
                  <button onClick={() => setEditing(true)} className="text-sm px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition">{t('common.edit')}</button>
                ) : (
                  <>
                    <button onClick={handleSave} disabled={saving} className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">{saving ? 'Saving...' : t('common.save')}</button>
                    <button onClick={() => setEditing(false)} className="text-sm px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition">{t('common.cancel')}</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Draft banner — submit for approval */}
        {isAgentOrAdmin && change.status === 'draft' && (
          <div className="p-4 bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 rounded-xl flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">📝 This change is still a draft</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {change.change_type === 'standard'
                  ? 'Standard changes are pre-approved by policy — submitting will move it straight to Approved.'
                  : 'Submit it for CAB review once impact, rollback plan, and CAB members are filled in.'}
              </p>
            </div>
            <button onClick={handleSubmitForApproval} disabled={submitting}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50 flex-shrink-0">
              {submitting ? 'Submitting...' : '📤 Submit for Approval'}
            </button>
          </div>
        )}

        {/* Approval banner */}
        {canApprove && change.status === 'pending_approval' && !showRejectForm && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">⏳ This change is awaiting your approval</p>
            <div className="flex gap-2">
              <button onClick={handleApprove} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition">✅ Approve</button>
              <button onClick={() => setShowRejectForm(true)} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition">❌ Reject</button>
            </div>
          </div>
        )}
        {showRejectForm && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl space-y-3">
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} className={inp} placeholder="Reason for rejection..." />
            <div className="flex gap-2">
              <button onClick={handleReject} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition">Confirm Reject</button>
              <button onClick={() => setShowRejectForm(false)} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">Cancel</button>
            </div>
          </div>
        )}

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {[['details','📋 Details'],['tasks','✅ Tasks'],['comments','💬 Comments'],['review','📝 Post-Review']].map(([key,label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
                    className={`px-4 py-2 text-sm font-medium transition rounded-t-lg ${activeTab===key ? 'bg-white dark:bg-gray-800 border border-b-white dark:border-b-gray-800 border-gray-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {label}
              {key === 'tasks' && tasks.length > 0 && ` (${tasks.filter(t=>t.is_done).length}/${tasks.length})`}
              {key === 'comments' && comments.length > 0 && ` (${comments.length})`}
            </button>
          ))}
        </div>

        {/* Details tab */}
        {activeTab === 'details' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2 space-y-5">
              {/* Description */}
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Description</h3>
                {editing ? <textarea rows={4} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className={inp} />
                          : <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{change.description}</p>}
              </div>
              {/* Impact */}
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">🎯 Impact Assessment</h3>
                {editing ? <textarea rows={3} value={form.impact} onChange={e => setForm({...form, impact: e.target.value})} className={inp} placeholder="Who and what will be affected by this change?" />
                          : <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{change.impact || <span className="italic text-gray-400">Not specified</span>}</p>}
              </div>
              {/* Rollback plan */}
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">🔄 Rollback / Backout Plan</h3>
                {editing ? <textarea rows={3} value={form.rollback_plan} onChange={e => setForm({...form, rollback_plan: e.target.value})} className={inp} placeholder="What to do if this change fails or needs to be reversed?" />
                          : <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{change.rollback_plan || <span className="italic text-gray-400">Not specified</span>}</p>}
              </div>
              {/* Test plan */}
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">🧪 Test / Validation Plan</h3>
                {editing ? <textarea rows={3} value={form.test_plan} onChange={e => setForm({...form, test_plan: e.target.value})} className={inp} placeholder="How will you verify the change was successful?" />
                          : <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{change.test_plan || <span className="italic text-gray-400">Not specified</span>}</p>}
              </div>
            </div>

            {/* Right sidebar */}
            <div className="space-y-4">
              {/* Metadata */}
              <div className={card}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Details</h3>
                <div className="space-y-3">
                  {editing ? (
                    <>
                      <div><label className="text-xs text-gray-500 block mb-1">Change Type</label>
                        <select value={form.change_type} onChange={e => setForm({...form, change_type: e.target.value})} className={inp}>
                          <option value="normal">Normal</option>
                          <option value="standard">Standard (pre-approved)</option>
                          <option value="emergency">Emergency</option>
                        </select>
                      </div>
                      <div><label className="text-xs text-gray-500 block mb-1">Risk Level</label>
                        <select value={form.risk_level} onChange={e => setForm({...form, risk_level: e.target.value})} className={inp}>
                          {['low','medium','high','critical'].map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div><label className="text-xs text-gray-500 block mb-1">Risk Score (1-25)</label>
                        <input type="number" min={1} max={25} value={form.risk_score} onChange={e => setForm({...form, risk_score: e.target.value})} className={inp} placeholder="Impact × Likelihood" />
                      </div>
                      <div><label className="text-xs text-gray-500 block mb-1">Status</label>
                        <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className={inp}>
                          {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                        </select>
                      </div>
                      <div><label className="text-xs text-gray-500 block mb-1">Change Owner</label>
                        <select value={form.owner_id} onChange={e => setForm({...form, owner_id: e.target.value})} className={inp}>
                          <option value="">Select owner...</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                        </select>
                      </div>
                      <div><label className="text-xs text-gray-500 block mb-1">Assigned To</label>
                        <select value={form.assigned_to_id} onChange={e => setForm({...form, assigned_to_id: e.target.value})} className={inp}>
                          <option value="">Unassigned</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                        </select>
                      </div>
                      <div><label className="text-xs text-gray-500 block mb-1">Planned Date</label><input type="date" value={form.planned_date} onChange={e => setForm({...form, planned_date: e.target.value})} className={inp} /></div>
                      <div><label className="text-xs text-gray-500 block mb-1">Start Date/Time</label><input type="datetime-local" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} className={inp} /></div>
                      <div><label className="text-xs text-gray-500 block mb-1">End Date/Time</label><input type="datetime-local" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} className={inp} /></div>
                      <div><label className="text-xs text-gray-500 block mb-1">CAB Members (user IDs)</label>
                        <select multiple value={form.cab_members.map(String)} onChange={e => setForm({...form, cab_members: [...e.target.selectedOptions].map(o => parseInt(o.value))})} className={inp + " h-24"}>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                        </select>
                      </div>
                      <div><label className="text-xs text-gray-500 block mb-1">Linked Tickets (IDs)</label><input value={form.linked_ticket_ids} onChange={e => setForm({...form, linked_ticket_ids: e.target.value})} className={inp} placeholder="e.g. 1, 2, 3" /></div>
                      <div><label className="text-xs text-gray-500 block mb-1">Linked Assets (IDs)</label><input value={form.linked_asset_ids} onChange={e => setForm({...form, linked_asset_ids: e.target.value})} className={inp} placeholder="e.g. 4, 5" /></div>
                    </>
                  ) : (
                    <>
                      {[
                        ['Requester', change.requester_name],
                        ['Owner', change.owner_name || '—'],
                        ['Assigned', change.assigned_to_name || '—'],
                        ['Planned', change.planned_date ? new Date(change.planned_date).toLocaleDateString() : '—'],
                        ['Start', change.start_date ? new Date(change.start_date).toLocaleString() : '—'],
                        ['End', change.end_date ? new Date(change.end_date).toLocaleString() : '—'],
                      ].map(([k,v]) => (
                        <div key={k} className="flex justify-between text-sm">
                          <span className="text-gray-500 dark:text-gray-400">{k}</span>
                          <span className="text-gray-800 dark:text-white font-medium">{v}</span>
                        </div>
                      ))}
                      {/* CAB members */}
                      {change.cab_member_names?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">CAB Members</p>
                          {change.cab_member_names.map(m => (
                            <span key={m.id} className="inline-block text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full mr-1 mb-1">{m.name}</span>
                          ))}
                        </div>
                      )}
                      {/* Linked tickets */}
                      {change.linked_ticket_ids?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Linked Tickets</p>
                          <div className="flex flex-wrap gap-1">
                            {change.linked_ticket_ids.map(tid => (
                              <Link key={tid} to={`/tickets/${tid}`} className="text-xs bg-gray-100 dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded hover:underline">#{tid}</Link>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Linked assets */}
                      {change.linked_asset_ids?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Linked Assets</p>
                          <div className="flex flex-wrap gap-1">
                            {change.linked_asset_ids.map(aid => (
                              <Link key={aid} to={`/assets/${aid}`} className="text-xs bg-gray-100 dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded hover:underline">Asset #{aid}</Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tasks tab */}
        {activeTab === 'tasks' && (
          <div className={card}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">✅ Change Tasks</h3>
            <div className="space-y-2 mb-4">
              {tasks.length === 0 && <p className="text-sm text-gray-400 italic">No tasks yet</p>}
              {tasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg group">
                  <input type="checkbox" checked={task.is_done} onChange={() => handleToggleTask(task)} className="rounded border-gray-300 text-indigo-600" />
                  <span className={`text-sm flex-1 ${task.is_done ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>{task.title}</span>
                  {task.assigned_to_name && <span className="text-xs text-gray-400">{task.assigned_to_name}</span>}
                  <button onClick={() => handleDeleteTask(task.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs transition">✕</button>
                </div>
              ))}
            </div>
            {isAgentOrAdmin && (
              <div className="flex gap-2">
                <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                       placeholder="Add a task..." className={inp + " flex-1"} />
                <button onClick={handleAddTask} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">Add</button>
              </div>
            )}
          </div>
        )}

        {/* Comments tab */}
        {activeTab === 'comments' && (
          <div className={card}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">💬 Discussion</h3>
            <div className="space-y-4 mb-4">
              {comments.length === 0 && <p className="text-sm text-gray-400 italic">No comments yet</p>}
              {comments.map(c => (
                <div key={c.id} className={`flex gap-3 ${c.is_internal ? 'opacity-90' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white ${c.is_internal ? 'bg-amber-500' : 'bg-indigo-500'}`}>
                    {c.author_name?.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-800 dark:text-white">{c.author_name}</span>
                      {c.is_internal && <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-1.5 py-0.5 rounded">Internal</span>}
                      <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
            {isAgentOrAdmin && (
              <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
                <textarea value={newComment} onChange={e => setNewComment(e.target.value)} rows={3}
                          placeholder={isInternal ? '🔒 Internal note — only visible to agents...' : 'Add a comment...'}
                          className={`${inp} ${isInternal ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : ''}`} />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-gray-400">
                    <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="rounded" />
                    Internal note
                  </label>
                  <button onClick={handleAddComment} disabled={!newComment.trim()}
                          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
                    Add Comment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Post-review tab */}
        {activeTab === 'review' && (
          <div className={card}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-2">📝 Post-Implementation Review</h3>
            <p className="text-xs text-gray-400 mb-4">Record what happened during and after the change — lessons learned, issues encountered, success metrics.</p>
            {change.post_review_at && <p className="text-xs text-green-600 dark:text-green-400 mb-2">✅ Last reviewed {new Date(change.post_review_at).toLocaleString()}</p>}
            <textarea value={postReview} onChange={e => setPostReview(e.target.value)} rows={6}
                      className={inp + " mb-3"} placeholder="Describe the outcome of this change: what went well, what went wrong, what to do differently next time..." />
            {isAgentOrAdmin && (
              <button onClick={handleSavePostReview} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">Save Review</button>
            )}
          </div>
        )}

        <div className="pb-4">
          <Link to="/changes" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← Back to Changes</Link>
        </div>
      </div>
    </Layout>
  );
}
