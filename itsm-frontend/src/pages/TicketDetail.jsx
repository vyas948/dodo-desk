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
  pencil: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  ),
  xmark: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
};

export default function TicketDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);
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
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [editPriority, setEditPriority] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [watchers, setWatchers] = useState([]);
  const [watcherLoading, setWatcherLoading] = useState(false);
  // Time tracking
  const [timeEntries, setTimeEntries] = useState([]);
  const [totalHours, setTotalHours] = useState(0);
  const [timeMinutes, setTimeMinutes] = useState('');
  const [timeNote, setTimeNote] = useState('');
  const [loggingTime, setLoggingTime] = useState(false);
  // Parent-child links
  const [ticketLinks, setTicketLinks] = useState({ parent: null, children: [] });
  // New features
  const [tasks, setTasks]                   = useState([]);
  const [newTask, setNewTask]               = useState('');
  const [macros, setMacros]                 = useState([]);
  const [applyingMacro, setApplyingMacro]   = useState(false);
  const [customFields, setCustomFields]     = useState([]);
  const [customFieldValues, setCustomFieldValues] = useState({});
  const [savingCustomFields, setSavingCustomFields] = useState(false);
  const [problemLinks, setProblemLinks]     = useState({ linked_incidents: [], linked_problem: null });
  const [problemInput, setProblemInput]     = useState('');
  const [dueDate, setDueDate]               = useState('');
  const [savingDueDate, setSavingDueDate]   = useState(false);
  // @mention autocomplete
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionQuery, setMentionQuery]     = useState('');
  const [linkChildId, setLinkChildId] = useState('');
  const [linking, setLinking] = useState(false);
  const [addWatcherEmail, setAddWatcherEmail] = useState('');
  const [showAddWatcher, setShowAddWatcher] = useState(false);
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const CATEGORIES = ['Hardware', 'Software', 'Network', 'Account', 'Email', 'Security', 'Printer', 'Mobile Device', 'Cloud Services', 'Telephony', 'Other'];
  const [approvalComment, setApprovalComment] = useState('');
  const { toast } = useToast();

  // Collision detection — who else is viewing this ticket
  const [activeViewers, setActiveViewers] = useState([]);
  // Tags
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  // Merge
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [merging, setMerging] = useState(false);
  // KB search in ticket
  const [kbSearchTerm, setKbSearchTerm] = useState('');
  const [kbResults, setKbResults] = useState([]);
  const [kbSearching, setKbSearching] = useState(false);
  const [selectedKbArticle, setSelectedKbArticle] = useState(null);
  // Resolution note local state
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionError, setResolutionError] = useState('');
  const [savingResolution, setSavingResolution] = useState(false);
  // Closing message to requester (sent simultaneously with resolve)
  const [closingMessage, setClosingMessage] = useState('');
  const [sendClosingMessage, setSendClosingMessage] = useState(true);
  // Create KB from resolution
  const [showCreateKb, setShowCreateKb] = useState(false);
  const [kbArticleTitle, setKbArticleTitle] = useState('');
  const [creatingKb, setCreatingKb] = useState(false);

  // Register presence and poll every 15s
  useEffect(() => {
    if (!token || !id) return;
    if (!['agent','admin','super_admin'].includes(user?.role)) return; // only track agents

    const ping = () => {
      apiFetch(`/tickets/${id}/presence`, token, { method: 'POST' }).catch(() => {})
        .then(data => setActiveViewers(data.viewers || []))
        .catch(() => {});
    };
    ping(); // immediate on mount
    const interval = setInterval(ping, 15000);

    // Remove presence on unmount
    return () => {
      clearInterval(interval);
      apiFetch(`/tickets/${id}/presence`, token, { method: 'DELETE' }).catch(() => {});
    };
  }, [token, id, user?.role]);

  useEffect(() => {
    fetchTicket();
    fetchComments();
    fetchAssets();
    fetchCannedResponses();
    fetchAttachments();
    fetchAuditLog();
    fetchApprovals();
    fetchTimeEntries();
    fetchTicketLinks();
    if (['agent','admin','super_admin'].includes(user?.role)) {
      fetchAgents();
      fetchTasks();
      fetchMacros();
      fetchCustomFields();
      fetchProblemLinks();
    }
  }, [id, token]);

  const fetchApprovals = () => {
    apiFetch(`/tickets/${id}/approvals`, token)
      .then(data => setApprovals(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const fetchTicket = () => {
    fetch(`${API}/tickets/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setTicket(data);
        setStatus(data.status);
        setResolutionNote(data.resolution_note || '');
        if (data.resolution_kb_article_id) setSelectedKbArticle({ id: data.resolution_kb_article_id });
        setSelectedAssetId(data.asset_id ? data.asset_id.toString() : '');
        setWatchers(data.watchers || []);
      })
      .catch(() => {});
  };
  const fetchComments = () => {
    fetch(`${API}/tickets/${id}/comments`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json()).then(setComments).catch(() => {});
  };
  const fetchAssets = () => {
    fetch(`${API}/assets/?limit=200`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAssets(data.items ?? []))
      .catch(() => {});
  };
  const fetchCannedResponses = () => {
    fetch(`${API}/canned-responses/?limit=200`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setCannedResponses(data.items ?? []))
      .catch(() => {});
  };
  const fetchAgents = () => {
    fetch(`${API}/admin/users?limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setAgents((data.items ?? []).filter(u => ['agent','admin','super_admin'].includes(u.role))))
      .catch(() => {});
    apiFetch('/groups/', token)
      .then(data => setGroups(Array.isArray(data) ? data : []))
      .catch(() => {});
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

  const fetchTimeEntries = () => {
    apiFetch(`/tickets/${id}/time-entries`, token)
      .then(data => {
        setTimeEntries(data.entries || []);
        setTotalHours(data.total_hours || 0);
      })
      .catch(() => {});
  };

  const fetchTicketLinks = () => {
    apiFetch(`/tickets/${id}/links`, token)
      .then(data => setTicketLinks(data))
      .catch(() => {});
  };

  const fetchTasks = () => {
    apiFetch(`/tickets/${id}/tasks`, token)
      .then(data => setTasks(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const fetchMacros = () => {
    apiFetch('/macros/', token)
      .then(data => setMacros(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  const fetchCustomFields = async () => {
    try {
      const fields = await apiFetch('/admin/custom-fields', token);
      setCustomFields(Array.isArray(fields) ? fields : []);
      // Load current values from ticket
      const t = await apiFetch(`/tickets/${id}`, token);
      if (t.custom_fields_data) {
        try { setCustomFieldValues(JSON.parse(t.custom_fields_data)); } catch {}
      }
      if (t.due_date) setDueDate(t.due_date.slice(0,16));
    } catch {}
  };

  const fetchProblemLinks = () => {
    apiFetch(`/tickets/${id}/problem-links`, token)
      .then(data => setProblemLinks(data))
      .catch(() => {});
  };

  const handleApplyMacro = async (macroId) => {
    setApplyingMacro(true);
    try {
      const res = await apiFetch(`/macros/${macroId}/apply/${id}`, token, { method: 'POST' });
      toast.success(`Macro applied: ${res.applied?.join(', ') || 'done'}`);
      fetchTicket();
    } catch(e) { toast.error(e.message); }
    finally { setApplyingMacro(false); }
  };

  const handleSaveCustomFields = async () => {
    setSavingCustomFields(true);
    try {
      await apiFetch(`/tickets/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ custom_fields_data: customFieldValues, due_date: dueDate || null })
      });
      toast.success('Fields saved');
    } catch(e) { toast.error(e.message); }
    finally { setSavingCustomFields(false); }
  };

  const handleAddTask = async () => {
    if (!newTask.trim()) return;
    try {
      await apiFetch(`/tickets/${id}/tasks`, token, { method: 'POST', body: JSON.stringify({ title: newTask }) });
      setNewTask('');
      fetchTasks();
    } catch(e) { toast.error(e.message); }
  };

  const handleToggleTask = async (task) => {
    try {
      await apiFetch(`/tickets/${id}/tasks/${task.id}`, token, { method: 'PATCH', body: JSON.stringify({ is_done: !task.is_done }) });
      fetchTasks();
    } catch(e) { toast.error(e.message); }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await apiFetch(`/tickets/${id}/tasks/${taskId}`, token, { method: 'DELETE' });
      fetchTasks();
    } catch(e) { toast.error(e.message); }
  };

  const handleLinkProblem = async () => {
    const numId = parseInt(problemInput.replace(/[^0-9]/g, ''));
    if (!numId) return;
    try {
      await apiFetch(`/tickets/${id}/problem-links`, token, { method: 'POST', body: JSON.stringify({ problem_ticket_id: numId }) });
      setProblemInput('');
      fetchProblemLinks();
      toast.success('Linked to problem ticket');
    } catch(e) { toast.error(e.message); }
  };

  const handleMentionInput = async (val, field) => {
    const atMatch = val.match(/@(\w[\w ]*)$/);
    if (atMatch) {
      const q = atMatch[1];
      setMentionQuery(q);
      try {
        const users = await apiFetch(`/users/?search=${encodeURIComponent(q)}&limit=5`, token);
        setMentionResults(Array.isArray(users) ? users : (users.items ?? []));
      } catch { setMentionResults([]); }
    } else {
      setMentionResults([]);
      setMentionQuery('');
    }
  };

  const insertMention = (user, currentVal, setter) => {
    const replaced = currentVal.replace(/@(\w[\w ]*)$/, `@${user.full_name} `);
    setter(replaced);
    setMentionResults([]);
  };

  const handleSubmitComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`${API}/tickets/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: newComment, is_internal: isInternalNote }),
      });
      if (!res.ok) throw new Error('Failed to add comment');
      const added = await res.json();
      setComments([...comments, added]);
      setNewComment('');
      setIsInternalNote(false);
      setError('');
    } catch (err) { setError(err.message); }
    finally { setSubmittingComment(false); }
  };

  const handleReopen = async () => {
    try {
      await apiFetch(`/tickets/${id}/reopen`, token, { method: 'POST' });
      toast.success('Ticket reopened successfully.');
      fetchAll();
    } catch (err) { toast.error(err.message); }
  };

  const handleFieldUpdate = async (field, value) => {
    setSavingField(true);
    // Optimistic update
    setTicket(t => t ? { ...t, [field]: value } : t);
    try {
      await apiFetch(`/tickets/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      toast.success(`${field.charAt(0).toUpperCase() + field.slice(1)} updated.`);
      setEditingField(null);
      fetchTicket(); // sync in background
    } catch (err) {
      fetchTicket(); // revert on failure
      toast.error(err.message);
    }
    finally { setSavingField(false); }
  };

  const isWatching = watchers.some(w => w.user_id === user?.id);

  const handleToggleWatch = async () => {
    setWatcherLoading(true);
    try {
      if (isWatching) {
        await apiFetch(`/tickets/${id}/watch`, token, { method: 'DELETE' });
        setWatchers(w => w.filter(x => x.user_id !== user?.id));
        toast.success('You are no longer watching this ticket.');
      } else {
        await apiFetch(`/tickets/${id}/watch`, token, { method: 'POST' });
        setWatchers(w => [...w, { user_id: user?.id, full_name: user?.full_name, email: user?.email }]);
        toast.success('You are now watching this ticket.');
      }
    } catch (err) { toast.error(err.message); }
    finally { setWatcherLoading(false); }
  };

  const handleAddWatcher = async (userId) => {
    try {
      await apiFetch(`/tickets/${id}/watchers/add`, token, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      fetchTicket();
      setShowAddWatcher(false);
      toast.success('Watcher added.');
    } catch (err) { toast.error(err.message); }
  };

  const handleRemoveWatcher = async (userId) => {
    try {
      await apiFetch(`/tickets/${id}/watchers/${userId}`, token, { method: 'DELETE' });
      setWatchers(w => w.filter(x => x.user_id !== userId));
      toast.success('Watcher removed.');
    } catch (err) { toast.error(err.message); }
  };

  const handleSaveStatus = async () => {
    // Enforce resolution note when resolving or closing
    if ((status === 'resolved' || status === 'closed') && !resolutionNote.trim()) {
      setResolutionError('A resolution note is required before marking this ticket as resolved.');
      return;
    }
    setResolutionError('');
    setSavingStatus(true);
    setTicket(t => t ? { ...t, status } : t);
    try {
      // Save resolution note first if resolving
      if ((status === 'resolved' || status === 'closed') && resolutionNote.trim()) {
        await apiFetch(`/tickets/${id}`, token, {
          method: 'PATCH',
          body: JSON.stringify({ resolution_note: resolutionNote }),
        });
        // Link KB article if selected
        if (selectedKbArticle?.id) {
          await apiFetch(`/tickets/${id}`, token, {
            method: 'PATCH',
            body: JSON.stringify({ resolution_kb_article_id: selectedKbArticle.id }),
          });
        }
      }
      const patchRes = await fetch(`${API}/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (!patchRes.ok) throw new Error('Failed to update status');
      // Post closing message to requester (public comment)
      if (sendClosingMessage && closingMessage.trim()) {
        await fetch(`${API}/tickets/${id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ body: closingMessage.trim(), is_internal: false }),
        });
        setClosingMessage('');
        fetchComments();
      }
      // Post internal justification note
      if (justification.trim()) {
        await fetch(`${API}/tickets/${id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ body: justification, is_internal: true }),
        });
        setJustification('');
        fetchComments();
      }
      fetchTicket();
      toast.success('Status updated successfully.');
    } catch (err) {
      fetchTicket();
      setError(err.message);
    }
    finally { setSavingStatus(false); }
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
  const has_edit_permission = ['agent','admin','super_admin'].includes(user?.role);
  const conversationItemClass = "flex-1 bg-gray-50 dark:bg-gray-700 rounded-lg p-4";
  const avatarClass = "flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-sm font-medium";

  return (
    <Layout>
      <div className="mb-4">
        <Link to="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400">{t('ticket.breadcrumb')}</Link>
        <span className="mx-2 text-gray-400 dark:text-gray-600">/</span>
        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{formatId(ticket.id, ticket.ticket_type)}</span>
      </div>

      {/* ── Collision Detection Banner ── */}
      {activeViewers.length > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-2.5">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <span className="font-semibold">
              {activeViewers.map(v => v.full_name).join(', ')}
            </span>
            {' '}{activeViewers.length === 1 ? 'is' : 'are'} also viewing this ticket
          </p>
        </div>
      )}

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
                ticket.status === 'pending_user' ? 'bg-orange-50 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
                ticket.status === 'pending_vendor' ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300' :
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

            {/* Resolution Note — shown prominently when resolved */}
            {ticket.resolution_note && (ticket.status === 'resolved' || ticket.status === 'closed') && (
              <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600 dark:text-green-400 font-semibold text-sm">✅ Resolution</span>
                    {ticket.resolved_at && (
                      <span className="text-xs text-gray-400">· {new Date(ticket.resolved_at).toLocaleDateString()}</span>
                    )}
                    {ticket.resolution_kb_article_id && (
                      <Link to={`/kb/${ticket.resolution_kb_article_id}`}
                            className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                        📖 View KB article
                      </Link>
                    )}
                  </div>
                  {/* Feature 4: Create KB article from resolution */}
                  {has_edit_permission && !ticket.resolution_kb_article_id && (
                    <button
                      onClick={() => { setShowCreateKb(true); setKbArticleTitle(ticket.title); }}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 border border-indigo-200 dark:border-indigo-700 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
                    >
                      📝 Save as KB article
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">{ticket.resolution_note}</p>

                {/* Create KB modal */}
                {showCreateKb && (
                  <div className="mt-3 p-3 border border-indigo-200 dark:border-indigo-700 rounded-lg bg-white dark:bg-gray-800 space-y-2">
                    <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">📝 Create Knowledge Base Article</p>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Article Title</label>
                      <input
                        type="text"
                        value={kbArticleTitle}
                        onChange={e => setKbArticleTitle(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <p className="text-xs text-gray-400">The resolution note will be used as the article content.</p>
                    <div className="flex gap-2">
                      <button
                        disabled={creatingKb || !kbArticleTitle.trim()}
                        onClick={async () => {
                          setCreatingKb(true);
                          try {
                            const result = await apiFetch(`/tickets/${ticket.id}/create-kb-article`, token, {
                              method: 'POST',
                              body: JSON.stringify({ title: kbArticleTitle, category: ticket.category || 'General' }),
                            });
                            toast.success('KB article created successfully!');
                            setShowCreateKb(false);
                            fetchTicket();
                          } catch(err) { toast.error(err.message); }
                          finally { setCreatingKb(false); }
                        }}
                        className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50 transition"
                      >
                        {creatingKb ? 'Creating...' : 'Create Article'}
                      </button>
                      <button onClick={() => setShowCreateKb(false)}
                              className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tags */}
            <div className="mt-4">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mr-1">{t('ticket.tags')||'Tags'}:</span>
                {(ticket.tags || []).map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
                    #{tag}
                    {has_edit_permission && (
                      <button type="button" onClick={async () => {
                        const newTags = (ticket.tags || []).filter(t => t !== tag);
                        await apiFetch(`/tickets/${ticket.id}`, token, { method: 'PATCH', body: JSON.stringify({ tags: newTags }) });
                        fetchTicket();
                      }} className="hover:text-red-500 ml-0.5">✕</button>
                    )}
                  </span>
                ))}
                {has_edit_permission && (
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={async e => {
                        if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                          e.preventDefault();
                          const newTag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
                          if (!newTag) return;
                          const existing = ticket.tags || [];
                          if (existing.includes(newTag)) { setTagInput(''); return; }
                          setSavingTags(true);
                          await apiFetch(`/tickets/${ticket.id}`, token, { method: 'PATCH', body: JSON.stringify({ tags: [...existing, newTag] }) });
                          setTagInput('');
                          setSavingTags(false);
                          fetchTicket();
                        }
                      }}
                      placeholder="Add tag..."
                      className="px-2 py-0.5 text-xs border border-dashed border-gray-300 dark:border-gray-600 rounded-full bg-transparent text-gray-600 dark:text-gray-400 focus:outline-none focus:border-indigo-400 w-24"
                    />
                    {savingTags && <span className="text-xs text-gray-400">saving...</span>}
                  </div>
                )}
                {(ticket.tags || []).length === 0 && !has_edit_permission && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">No tags</span>
                )}
              </div>
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('ticket.attachments')}</h4>
                <div className="flex flex-wrap gap-2">
                  {attachments.map(att => (
                    <a key={att.id}
                       href={att.url || `${API}/attachments/${att.id}/download`}
                       className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900 hover:border-indigo-200 transition"
                       target="_blank" rel="noopener noreferrer" download={!att.url}>
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
                    <div className={c.is_internal ? 'w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0' : avatarClass}>
                      {c.author_name.charAt(0).toUpperCase()}
                    </div>
                    <div className={c.is_internal
                      ? 'flex-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3'
                      : conversationItemClass}>
                      <div className="flex justify-between items-center mb-1 flex-wrap gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-800 dark:text-white">{c.author_name}</span>
                          {c.is_internal && (
                            <span className="text-xs bg-amber-100 dark:bg-amber-800 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">🔒 Internal note</span>
                          )}
                        </div>
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
                {/* Toolbar: internal note toggle + canned response picker */}
                {['agent','admin','super_admin'].includes(user?.role) && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={isInternalNote} onChange={e => setIsInternalNote(e.target.checked)}
                             className="rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">🔒 {t('ticket.internalNote') || 'Internal note'}</span>
                    </label>
                    {cannedResponses.length > 0 && (
                      <select defaultValue=""
                              onChange={async e => {
                                const r = cannedResponses.find(r => r.id === parseInt(e.target.value));
                                if (r) {
                                  // Resolve variables
                                  const resolved = r.content
                                    .replace(/\{\{requester\.name\}\}/g, ticket?.requester_name || '')
                                    .replace(/\{\{requester\.email\}\}/g, ticket?.requester_email || '')
                                    .replace(/\{\{ticket\.id\}\}/g, ticket ? `#${ticket.id}` : '')
                                    .replace(/\{\{ticket\.title\}\}/g, ticket?.title || '')
                                    .replace(/\{\{agent\.name\}\}/g, user?.full_name || '')
                                    .replace(/\{\{company\.name\}\}/g, 'DodoBay Ltd');
                                  setNewComment(prev => prev ? prev + '\n\n' + resolved : resolved);
                                  // Track usage
                                  try { await apiFetch(`/canned-responses/${r.id}/use`, token, { method: 'POST' }); } catch {}
                                }
                                e.target.value = '';
                              }}
                              className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                        <option value="" disabled>💬 Insert canned response...</option>
                        {Object.entries(cannedResponses.reduce((acc, r) => {
                          const cat = r.category || 'General';
                          if (!acc[cat]) acc[cat] = [];
                          acc[cat].push(r);
                          return acc;
                        }, {})).map(([cat, items]) => (
                          <optgroup key={cat} label={cat}>
                            {items.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                <div className="relative">
                  <textarea rows={3} value={newComment}
                            onChange={e => { setNewComment(e.target.value); if (isInternalNote) handleMentionInput(e.target.value); }}
                            placeholder={isInternalNote ? '🔒 Internal note — type @Name to mention an agent...' : t('ticket.reply')}
                            className={`w-full border rounded-lg p-3 pr-12 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 resize-none ${isInternalNote ? 'border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-300 dark:border-gray-600'}`} />
                  <button type="submit" disabled={submittingComment} className="absolute bottom-3 right-3 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 disabled:opacity-40">
                    {submittingComment ? <span className="text-xs">⏳</span> : icons.send}
                  </button>
                  {mentionResults.length > 0 && (
                    <div className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                      {mentionResults.map(u => (
                        <button key={u.id} type="button"
                                onClick={() => insertMention(u, newComment, setNewComment)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 text-xs flex items-center justify-center font-bold flex-shrink-0">{u.full_name?.charAt(0)}</span>
                          <span className="text-gray-800 dark:text-white">{u.full_name}</span>
                          <span className="text-xs text-gray-400">{u.role}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {error && <p className="text-red-500 text-xs">{error}</p>}
              </form>
            </div>

            {/* ── Full-width Resolution Panel — shown when resolving ── */}
            {has_edit_permission && (status === 'resolved' || status === 'closed') && (
              <div className="mt-4 border border-green-300 dark:border-green-700 rounded-xl bg-green-50 dark:bg-green-900/20 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-5 py-3 bg-green-100 dark:bg-green-900/40 border-b border-green-200 dark:border-green-800">
                  <span className="text-green-700 dark:text-green-400 font-semibold text-sm">✅ {t('ticket.resolutionNote') || 'Resolution Details'}</span>
                  <span className="text-xs text-green-600 dark:text-green-500">— {t('ticket.resolutionFillIn') || 'fill in before saving'}</span>
                </div>

                <div className="p-5 space-y-5">
                  {/* Resolution Note + inline KB search */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('ticket.resolutionNote') || 'Resolution Note'} <span className="text-red-500">*</span>
                        <span className="text-xs text-gray-400 font-normal ml-2">{t('ticket.resolutionNoteInternal') || 'Internal — not shown to requester'}</span>
                      </label>
                    </div>
                    <textarea
                      value={resolutionNote}
                      onChange={e => { setResolutionNote(e.target.value); setResolutionError(''); }}
                      placeholder={t('ticket.resolutionNotePlaceholder') || 'Describe the root cause, steps taken, and solution applied...'}
                      rows={4}
                      className={`w-full px-4 py-3 border ${resolutionError ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600'} rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none`}
                    />
                    {resolutionError && <p className="text-xs text-red-500 mt-1">⚠️ {resolutionError}</p>}

                    {/* KB search — inline below resolution note, no new tab */}
                    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 p-3">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('kb.linkKbArticle') || 'Link a KB article as resolution source'} <span className="font-normal text-gray-400">({t('common.optional') || 'optional'})</span></p>
                      {selectedKbArticle ? (
                        <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg px-3 py-2">
                          <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          <span className="text-sm text-indigo-700 dark:text-indigo-300 flex-1 font-medium">
                            {selectedKbArticle.title || `KB Article #${selectedKbArticle.id}`}
                          </span>
                          <button onClick={() => setSelectedKbArticle(null)} className="text-gray-400 hover:text-red-500 transition text-xs">✕ Remove</button>
                        </div>
                      ) : (
                        <div className="relative">
                          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <input
                            type="text"
                            value={kbSearchTerm}
                            onChange={async e => {
                              const q = e.target.value;
                              setKbSearchTerm(q);
                              if (q.trim().length < 2) { setKbResults([]); return; }
                              setKbSearching(true);
                              try {
                                const data = await apiFetch(`/kb/articles/?search=${encodeURIComponent(q)}&limit=5`, token);
                                setKbResults(data.items || data || []);
                              } catch { setKbResults([]); }
                              finally { setKbSearching(false); }
                            }}
                            placeholder={t('common.searchArticles') || 'Search knowledge base articles...'}
                            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          {kbSearching && <span className="absolute right-3 top-2.5 text-xs text-gray-400">searching…</span>}
                        </div>
                      )}
                      {kbResults.length > 0 && !selectedKbArticle && (
                        <div className="mt-1 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-700 shadow-sm">
                          {kbResults.map(a => (
                            <button key={a.id} type="button"
                              onClick={() => { setSelectedKbArticle(a); setKbSearchTerm(''); setKbResults([]); }}
                              className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition bg-white dark:bg-gray-800">
                              <p className="text-sm font-medium text-gray-800 dark:text-white">{a.title}</p>
                              {a.category && <p className="text-xs text-gray-400">{a.category}</p>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Closing message */}
                  <div className="border-t border-green-200 dark:border-green-800 pt-5">
                    <div className="flex items-center gap-2.5 mb-3">
                      <input type="checkbox" id="send-closing" checked={sendClosingMessage}
                             onChange={e => setSendClosingMessage(e.target.checked)}
                             className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                      <label htmlFor="send-closing" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                        {t('ticket.sendClosingMessage')||'Send closing message to requester'}
                      </label>
                    </div>
                    {sendClosingMessage && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{t('ticket.emailedTo')||'Emailed to'} <span className="font-medium text-gray-700 dark:text-gray-300">{ticket.requester_name}</span></span>
                          {cannedResponses.length > 0 && (
                            <select
                              defaultValue=""
                              onChange={async e => {
                                const r = cannedResponses.find(r => r.id === parseInt(e.target.value));
                                if (r) {
                                  const resolved = r.content
                                    .replace(/\{\{requester\.name\}\}/g, ticket?.requester_name || '')
                                    .replace(/\{\{ticket\.id\}\}/g, ticket ? `#${ticket.id}` : '')
                                    .replace(/\{\{ticket\.title\}\}/g, ticket?.title || '')
                                    .replace(/\{\{agent\.name\}\}/g, user?.full_name || '')
                                    .replace(/\{\{company\.name\}\}/g, 'DodoBay Ltd');
                                  setClosingMessage(prev => prev ? prev + '\n\n' + resolved : resolved);
                                  try { await apiFetch(`/canned-responses/${r.id}/use`, token, { method: 'POST' }); } catch {}
                                }
                                e.target.value = '';
                              }}
                              className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="" disabled>{t('ticket.insertCanned')||'Insert canned response...'}</option>
                              {cannedResponses.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                            </select>
                          )}
                        </div>
                        <textarea
                          value={closingMessage}
                          onChange={e => setClosingMessage(e.target.value)}
                          placeholder={`Hi ${ticket.requester_name || 'there'},\n\nYour ticket has been resolved. Please let us know if you need any further assistance.`}
                          rows={4}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                        <p className="text-xs text-gray-400">{t('ticket.sentAsPublicReply')||'Sent as a public reply — requester will receive an email notification.'}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">

          {/* Details card */}
          <div className={detailCardClass}>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{t('ticket.details')}</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.status')}</span><span className="font-medium capitalize text-gray-900 dark:text-white">{t(`ticket.${ticket.status}`)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.priority')}</span><span className="font-medium capitalize text-gray-900 dark:text-white">{t(`ticket.${ticket.priority}`)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.requester')}</span><span className="text-gray-900 dark:text-white">{ticket.requester_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.category')}</span><span className="text-gray-900 dark:text-white">{ticket.category || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.created')}</span><span className="text-gray-900 dark:text-white">{new Date(ticket.created_at).toLocaleDateString()}</span></div>
              {/* First Response Time */}
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t('ticket.firstResponse')||'First Response'}</span>
                <span className={`text-xs font-medium ${ticket.first_response_at ? 'text-green-600 dark:text-green-400' : 'text-amber-500 dark:text-amber-400'}`}>
                  {ticket.first_response_at ? (() => {
                    const mins = Math.round((new Date(ticket.first_response_at) - new Date(ticket.created_at)) / 60000);
                    if (mins < 60) return `${mins}m`;
                    const hrs = Math.floor(mins / 60);
                    const rem = mins % 60;
                    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
                  })() : (t('ticket.awaitingResponse')||'Awaiting response')}
                </span>
              </div>
              {ticket.sla_response_deadline && (
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.slaResponse')}</span><span className={ticket.sla_status === 'warning' ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-white'}>{new Date(ticket.sla_response_deadline).toLocaleString()}</span></div>
              )}
              {ticket.sla_resolution_deadline && (
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('ticket.slaResolution')}</span><span className={ticket.sla_status === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}>{new Date(ticket.sla_resolution_deadline).toLocaleString()}</span></div>
              )}
            </div>
          </div>

          {/* Agent & Admin Actions */}
          {(user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && ticket.status !== 'pending_approval' && (
            <div className={detailCardClass + " space-y-4"}>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('common.actions')}</h3>

              {/* Re-open button for resolved/closed tickets */}
              {(ticket.status === 'resolved' || ticket.status === 'closed') && (
                <button onClick={handleReopen}
                        className="w-full bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition">
                  {t('ticket.reopen') || 'Re-open Ticket'} 🔄
                </button>
              )}

              {/* Merge ticket */}
              {ticket.status !== 'closed' && !ticket.merged_into_id && (
                <div>
                  {!showMerge ? (
                    <button onClick={() => setShowMerge(true)}
                            className="w-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                      {t('ticket.mergeTicket') || 'Merge Ticket'} 🔀
                    </button>
                  ) : (
                    <div className="space-y-2 border border-amber-200 dark:border-amber-700 rounded-lg p-3 bg-amber-50 dark:bg-amber-900/20">
                      <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">⚠️ Merge this ticket into another. This ticket will be closed.</p>
                      <input
                        type="text"
                        value={mergeTargetId}
                        onChange={e => setMergeTargetId(e.target.value)}
                        placeholder="e.g. INC000005 or 5"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          if (!mergeTargetId) return;
                          const raw = mergeTargetId.trim().toUpperCase().replace(/^(INC|REQ|CHG)0*/, '');
                          const numId = parseInt(raw);
                          if (isNaN(numId)) { toast.error('Enter a valid ticket reference (e.g. INC000005)'); return; }
                          setMerging(true);
                          try {
                            await apiFetch(`/tickets/${ticket.id}/merge`, token, {
                              method: 'POST',
                              body: JSON.stringify({ primary_ticket_id: numId })
                            });
                            toast.success(`Merged into ticket #${numId}`);
                            navigate('/');
                          } catch(err) {
                            toast.error(err.message);
                            setMerging(false);
                          }
                        }} disabled={merging || !mergeTargetId}
                                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 transition">
                          {merging ? 'Merging...' : 'Confirm Merge'}
                        </button>
                        <button onClick={() => { setShowMerge(false); setMergeTargetId(''); }}
                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {ticket.merged_into_id && (
                <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 rounded-lg p-2 text-center">
                  🔀 Merged into <Link to={`/tickets/${ticket.merged_into_id}`} className="text-indigo-500 hover:underline">#{ticket.merged_into_id}</Link>
                </div>
              )}

              <div>
                <label className={labelClass}>{t('ticket.changeStatus')}</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={selectClass + " mb-2"}>
                  <option value="open">{t('ticket.open')}</option>
                  <option value="in_progress">{t('ticket.inProgress')}</option>
                  <option value="pending_user">{t('ticket.pending_user')}</option>
                  <option value="pending_vendor">{t('ticket.pending_vendor')}</option>
                  <option value="resolved">{t('ticket.resolved')}</option>
                  <option value="closed">{t('ticket.closed')}</option>
                </select>
                {/* Existing resolution summary when already resolved */}
                {ticket.status === 'resolved' && ticket.resolution_note && !['resolved','closed'].includes(status) && (
                  <div className="mb-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">✅ Resolution on record</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3">{ticket.resolution_note}</p>
                  </div>
                )}
                <button onClick={handleSaveStatus} disabled={savingStatus} className={btnPrimary + " w-full disabled:opacity-50"}>
                  {savingStatus ? '⏳ Saving...' : t('ticket.saveStatus') || 'Save Status'}
                </button>
              </div>


              {/* Inline Priority Edit */}
              <div>
                <label className={labelClass}>Priority</label>
                {editingField === 'priority' ? (
                  <div className="flex gap-2">
                    <select value={editPriority} onChange={e => setEditPriority(e.target.value)} className={selectClass + " flex-1"}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                    <button onClick={() => handleFieldUpdate('priority', editPriority)} disabled={savingField} className={btnPrimary + " disabled:opacity-50"}>{savingField ? "..." : "Save"}</button>
                    <button onClick={() => setEditingField(null)} className={btnSecondary}>✕</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{ticket.priority}</span>
                    <button onClick={() => { setEditPriority(ticket.priority); setEditingField('priority'); }}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  </div>
                )}
              </div>

              {/* Inline Category Edit */}
              <div>
                <label className={labelClass}>Category</label>
                {editingField === 'category' ? (
                  <div className="flex gap-2">
                    <select value={editCategory} onChange={e => setEditCategory(e.target.value)} className={selectClass + " flex-1"}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => handleFieldUpdate('category', editCategory)} disabled={savingField} className={btnPrimary + " disabled:opacity-50"}>{savingField ? "..." : "Save"}</button>
                    <button onClick={() => setEditingField(null)} className={btnSecondary}>✕</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{ticket.category || '—'}</span>
                    <button onClick={() => { setEditCategory(ticket.category || CATEGORIES[0]); setEditingField('category'); }}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  </div>
                )}
              </div>

              {/* Assign to agent */}
              <div>
                <label className={labelClass}>{t('ticket.assignTo') || 'Assign to agent'}</label>
                <select
                  value={selectedAssignee || ticket.assigned_to_id || ''}
                  onChange={e => setSelectedAssignee(e.target.value)}
                  className={selectClass + " mb-2"}
                >
                  <option value="">— {t('dashboard.unassigned')||'Unassigned'} —</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    await apiFetch(`/tickets/${ticket.id}`, token, {
                      method: 'PATCH',
                      body: JSON.stringify({ assigned_to_id: selectedAssignee ? parseInt(selectedAssignee) : null })
                    });
                    toast.success(selectedAssignee ? 'Ticket assigned' : 'Ticket unassigned');
                    fetchTicket();
                  }} className={btnPrimary + " flex-1 text-sm"}>
                    {t('common.save') || 'Save'}
                  </button>
                  <button onClick={handleAssignToMe} className={btnSecondary + " text-sm"}>
                    {t('ticket.assignToMe')}
                  </button>
                </div>
              </div>

              {/* Assign to group */}
              {groups.length > 0 && (
                <div>
                  <label className={labelClass}>{t("ticket.assignToGroup") || "Assign to group"}</label>
                  <select
                    value={selectedGroup || ticket.group_id || ''}
                    onChange={e => setSelectedGroup(e.target.value)}
                    className={selectClass + " mb-2"}
                  >
                    <option value="">— {t('groups.noGroup')||'No group'} —</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.member_count} members)</option>
                    ))}
                  </select>
                  <button onClick={async () => {
                    await apiFetch(`/tickets/${ticket.id}`, token, {
                      method: 'PATCH',
                      body: JSON.stringify({ group_id: selectedGroup ? parseInt(selectedGroup) : null })
                    });
                    toast.success(selectedGroup ? 'Group assigned' : 'Group removed');
                    fetchTicket();
                  }} className={btnPrimary + " w-full text-sm"}>
                    {t('common.save') || 'Save'}
                  </button>
                </div>
              )}

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

          {/* ── Watchers panel ── */}
          <div className={detailCardClass + " space-y-3"}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('ticket.watchers')||'Watchers'}</h3>
              <button
                onClick={handleToggleWatch}
                disabled={watcherLoading}
                className={`text-xs font-medium px-2.5 py-1 rounded-full transition disabled:opacity-50 ${
                  isWatching
                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {isWatching ? `👁 ${t('ticket.watching')||'Watching'}` : `+ ${t('ticket.watch')||'Watch'}`}
              </button>
            </div>

            {watchers.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('ticket.noWatchers')||'No watchers yet.'}</p>
            )}

            <div className="space-y-1.5">
              {watchers.map(w => (
                <div key={w.user_id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                      {w.full_name?.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs text-gray-700 dark:text-gray-300">{w.full_name}</span>
                  </div>
                  {(user?.role === 'agent' || user?.role === 'admin' || user?.role === 'super_admin') && (
                    <button onClick={() => handleRemoveWatcher(w.user_id)}
                            className="text-gray-300 hover:text-red-500 dark:hover:text-red-400 transition text-xs">✕</button>
                  )}
                </div>
              ))}
            </div>

            {/* Add watcher (agents/admins only) */}
            {(user?.role === 'agent' || user?.role === 'admin' || user?.role === 'super_admin') && (
              <div>
                {showAddWatcher ? (
                  <div className="space-y-1.5">
                    <select
                      onChange={e => { if (e.target.value) handleAddWatcher(parseInt(e.target.value)); }}
                      defaultValue=""
                      className={selectClass + " text-xs"}
                    >
                      <option value="">Select a user to add…</option>
                      {agents
                        .filter(a => !watchers.some(w => w.user_id === a.id))
                        .map(a => (
                          <option key={a.id} value={a.id}>{a.full_name}</option>
                        ))
                      }
                    </select>
                    <button onClick={() => setShowAddWatcher(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setShowAddWatcher(true)}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                    + {t('ticket.addWatcher')||'Add watcher'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Approval actions */}
          {(user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && ticket.status === 'pending_approval' && (
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
                const canDecide = isCurrentApprover || (user?.role === 'admin' || user?.role === 'super_admin');

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
                {t('auditLog.title')||'Audit Log'} ({auditLog.length} {t('auditLog.events')||'events'})
              </h3>
              <span className="text-gray-400 dark:text-gray-500 text-sm">{showAudit ? `▲ ${t('common.hide')||'Hide'}` : `▼ ${t('common.show')||'Show'}`}</span>
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
                          {entry.action === 'time_logged' && '⏱ Time logged'}
                          {entry.action === 'child_linked' && '🔗 Child ticket linked'}
                          {entry.action === 'merge_received' && '🔀 Merge received'}
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

            {/* ── Time Tracking Panel ── */}
            {has_edit_permission && (
              <div className={detailCardClass}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    ⏱ {t('ticket.timeTracking')||'Time Tracked'}
                  </h3>
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full">
                    {totalHours}h total
                  </span>
                </div>

                {/* Log time form */}
                <div className="space-y-2 mb-3">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      value={timeMinutes}
                      onChange={e => setTimeMinutes(e.target.value)}
                      placeholder="Minutes"
                      className="w-24 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                      type="text"
                      value={timeNote}
                      onChange={e => setTimeNote(e.target.value)}
                      placeholder={t('ticket.whatDidYouDo') || 'What did you do? (optional)'}
                      className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      disabled={loggingTime || !timeMinutes}
                      onClick={async () => {
                        if (!timeMinutes || parseInt(timeMinutes) <= 0) return;
                        setLoggingTime(true);
                        try {
                          await apiFetch(`/tickets/${ticket.id}/time-entries`, token, {
                            method: 'POST',
                            body: JSON.stringify({ minutes: parseInt(timeMinutes), note: timeNote }),
                          });
                          setTimeMinutes('');
                          setTimeNote('');
                          fetchTimeEntries();
                          toast.success('Time logged');
                        } catch(err) { toast.error(err.message); }
                        finally { setLoggingTime(false); }
                      }}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition whitespace-nowrap"
                    >
                      {loggingTime ? '...' : `+ ${t('ticket.logTime')||'Log'}`}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">{t('ticket.enterMinutes')||'Enter minutes (e.g. 30 = 30min, 90 = 1.5h)'}</p>
                </div>

                {/* Entries list */}
                {timeEntries.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {timeEntries.map(e => (
                      <div key={e.id} className="flex items-start justify-between text-xs">
                        <div>
                          <span className="font-medium text-gray-700 dark:text-gray-300">{e.agent_name}</span>
                          <span className="text-indigo-600 dark:text-indigo-400 ml-1 font-semibold">
                            {e.minutes >= 60 ? `${Math.floor(e.minutes/60)}h${e.minutes%60 > 0 ? ` ${e.minutes%60}m` : ''}` : `${e.minutes}m`}
                          </span>
                          {e.note && <p className="text-gray-400 italic">{e.note}</p>}
                        </div>
                        {(e.agent_id === user?.id || user?.role === 'admin' || user?.role === 'super_admin') && (
                          <button onClick={async () => {
                            await apiFetch(`/tickets/${ticket.id}/time-entries/${e.id}`, token, { method: 'DELETE' });
                            fetchTimeEntries();
                          }} className="text-gray-300 hover:text-red-500 transition ml-2 flex-shrink-0">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {timeEntries.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">{t('ticket.noTimeLogged')||'No time logged yet'}</p>
                )}
              </div>
            )}

            {/* ── Parent-Child Linking Panel ── */}
            {has_edit_permission && (
              <div className={detailCardClass}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  🔗 {t('ticket.linkedTickets')||'Linked Tickets'}
                </h3>

                {/* Parent ticket */}
                {ticketLinks.parent && (
                  <div className="mb-2">
                    <p className="text-xs text-gray-400 mb-1">Parent</p>
                    <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                      <Link to={`/tickets/${ticketLinks.parent.id}`}
                            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                        #{ticketLinks.parent.id} — {ticketLinks.parent.title}
                      </Link>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${ticketLinks.parent.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                        {ticketLinks.parent.status}
                      </span>
                    </div>
                  </div>
                )}

                {/* Child tickets */}
                {ticketLinks.children.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-gray-400 mb-1">Sub-tickets ({ticketLinks.children.length})</p>
                    <div className="space-y-1">
                      {ticketLinks.children.map(c => (
                        <div key={c.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                          <Link to={`/tickets/${c.id}`}
                                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                            #{c.id} — {c.title}
                          </Link>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                              {c.status}
                            </span>
                            <button onClick={async () => {
                              await apiFetch(`/tickets/${ticket.id}/links/${c.id}`, token, { method: 'DELETE' });
                              fetchTicketLinks();
                            }} className="text-gray-300 hover:text-red-500 transition text-xs">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Link a child ticket */}
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={linkChildId}
                    onChange={e => setLinkChildId(e.target.value)}
                    placeholder="e.g. INC000012 or 12"
                    className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    disabled={linking || !linkChildId}
                    onClick={async () => {
                      setLinking(true);
                      try {
                        // Accept INC000012, REQ000012, CHG000012 or plain number
                        const raw = linkChildId.trim().toUpperCase().replace(/^(INC|REQ|CHG)0*/, '');
                        const numId = parseInt(raw);
                        if (isNaN(numId)) { toast.error('Enter a valid ticket ID or reference (e.g. INC000012)'); setLinking(false); return; }
                        await apiFetch(`/tickets/${ticket.id}/links`, token, {
                          method: 'POST',
                          body: JSON.stringify({ child_id: numId }),
                        });
                        setLinkChildId('');
                        fetchTicketLinks();
                        toast.success('Ticket linked');
                      } catch(err) { toast.error(err.message); }
                      finally { setLinking(false); }
                    }}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    {linking ? '...' : 'Link'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">{t('ticket.enterTicketId')||'Enter the ID of a ticket to set as sub-ticket'}</p>
              </div>
            )}

            {/* ── Macros ── */}
            {isAgentOrAdmin && macros.length > 0 && (
              <div className={detailCardClass}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">⚡ Macros</h3>
                <div className="space-y-1">
                  {macros.slice(0,8).map(m => (
                    <button key={m.id} disabled={applyingMacro}
                            onClick={() => handleApplyMacro(m.id)}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300 transition disabled:opacity-50 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-700">
                      ⚡ {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Due Date ── */}
            {isAgentOrAdmin && (
              <div className={detailCardClass}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">📅 Due Date</h3>
                <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)}
                       className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2" />
                <button onClick={handleSaveCustomFields} disabled={savingCustomFields}
                        className="w-full bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
                  {savingCustomFields ? 'Saving...' : 'Save Due Date'}
                </button>
              </div>
            )}

            {/* ── Custom Fields ── */}
            {isAgentOrAdmin && customFields.length > 0 && (
              <div className={detailCardClass}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">🗂 Custom Fields</h3>
                <div className="space-y-3">
                  {customFields.map(field => (
                    <div key={field.id}>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        {field.name}{field.is_required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      {field.field_type === 'text' && (
                        <input type="text" value={customFieldValues[field.field_key]||''}
                               onChange={e => setCustomFieldValues(v => ({...v, [field.field_key]: e.target.value}))}
                               className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                      )}
                      {field.field_type === 'number' && (
                        <input type="number" value={customFieldValues[field.field_key]||''}
                               onChange={e => setCustomFieldValues(v => ({...v, [field.field_key]: e.target.value}))}
                               className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                      )}
                      {field.field_type === 'date' && (
                        <input type="date" value={customFieldValues[field.field_key]||''}
                               onChange={e => setCustomFieldValues(v => ({...v, [field.field_key]: e.target.value}))}
                               className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                      )}
                      {field.field_type === 'checkbox' && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={!!customFieldValues[field.field_key]}
                                 onChange={e => setCustomFieldValues(v => ({...v, [field.field_key]: e.target.checked}))}
                                 className="rounded" />
                          <span className="text-sm text-gray-600 dark:text-gray-300">Yes</span>
                        </label>
                      )}
                      {field.field_type === 'dropdown' && (
                        <select value={customFieldValues[field.field_key]||''}
                                onChange={e => setCustomFieldValues(v => ({...v, [field.field_key]: e.target.value}))}
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                          <option value="">Select...</option>
                          {(field.options||[]).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                  <button onClick={handleSaveCustomFields} disabled={savingCustomFields}
                          className="w-full bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50 mt-2">
                    {savingCustomFields ? 'Saving...' : 'Save Fields'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Tasks / Checklist ── */}
            {isAgentOrAdmin && (
              <div className={detailCardClass}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  ✅ Tasks {tasks.length > 0 && `(${tasks.filter(t=>t.is_done).length}/${tasks.length})`}
                </h3>
                <div className="space-y-1.5 mb-3">
                  {tasks.length === 0 && <p className="text-xs text-gray-400 italic">No tasks yet</p>}
                  {tasks.map(task => (
                    <div key={task.id} className="flex items-center gap-2 group">
                      <input type="checkbox" checked={task.is_done} onChange={() => handleToggleTask(task)}
                             className="rounded border-gray-300 text-indigo-600" />
                      <span className={`text-sm flex-1 ${task.is_done ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>{task.title}</span>
                      <button onClick={() => handleDeleteTask(task.id)}
                              className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs transition">✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newTask} onChange={e => setNewTask(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                         placeholder="Add a task..." className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                  <button onClick={handleAddTask} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition">Add</button>
                </div>
              </div>
            )}

            {/* ── Problem Management ── */}
            {isAgentOrAdmin && ticket?.ticket_type === 'incident' && (
              <div className={detailCardClass}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">🔴 Problem Link</h3>
                {problemLinks.linked_problem ? (
                  <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                    <span className="text-xs font-mono text-red-600 dark:text-red-400">#{problemLinks.linked_problem.id}</span>
                    <span className="text-xs text-red-700 dark:text-red-300 flex-1 truncate">{problemLinks.linked_problem.title}</span>
                    <button onClick={async () => { await apiFetch(`/tickets/${id}/problem-links`, token, {method:'DELETE'}); fetchProblemLinks(); }}
                            className="text-gray-400 hover:text-red-500 text-xs">✕</button>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-gray-400 mb-2">Link this incident to a root-cause problem ticket</p>
                    <div className="flex gap-2">
                      <input value={problemInput} onChange={e => setProblemInput(e.target.value)}
                             placeholder="INC000001 or ticket ID"
                             className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                      <button onClick={handleLinkProblem} className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-red-700 transition">Link</button>
                    </div>
                  </div>
                )}
                {problemLinks.linked_incidents?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">Linked incidents ({problemLinks.linked_incidents.length})</p>
                    {problemLinks.linked_incidents.map(inc => (
                      <div key={inc.id} className="text-xs text-gray-600 dark:text-gray-400 py-0.5">#{inc.id} — {inc.title}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </Layout>
  );
}