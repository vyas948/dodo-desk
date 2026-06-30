import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { API } from '../api';

export const TICKET_CATEGORIES = [
  'Hardware','Software','Network','Account','Email',
  'Security','Printer','Mobile Device','Cloud Services','Telephony','Other'
];

const PRIORITIES = [
  { value:'low',      label:'🟢 Low',      desc:'Non-urgent, can wait' },
  { value:'medium',   label:'🟡 Medium',   desc:'Normal priority' },
  { value:'high',     label:'🔴 High',     desc:'Important, resolve soon' },
  { value:'critical', label:'🚨 Critical', desc:'Service outage or emergency' },
];

const IMPACT_OPTS = ['Low — 1 user affected','Medium — team affected','High — department affected','Critical — organisation-wide'];
const URGENCY_OPTS = ['Low','Medium','High','Critical'];

export default function CreateTicket() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultType = searchParams.get('type') === 'service_request' ? 'service_request' : 'incident';
  const catalogItemId = searchParams.get('catalog_item');

  // Core fields
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]       = useState('');
  const [priority, setPriority]       = useState('medium');
  const [ticketType, setTicketType]   = useState(defaultType);
  const [tags, setTags]               = useState([]);
  const [tagInput, setTagInput]       = useState('');
  const [files, setFiles]             = useState([]);
  const [dragOver, setDragOver]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  // Agent extras
  const [onBehalfOf, setOnBehalfOf]           = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [groupId, setGroupId]                 = useState('');
  const [dueDate, setDueDate]                 = useState('');
  const [impact, setImpact]                   = useState('');
  const [urgency, setUrgency]                 = useState('');
  const [relatedAssetId, setRelatedAssetId]   = useState('');
  const [watcherIds, setWatcherIds]           = useState([]);
  const [customFieldValues, setCustomFieldValues] = useState({});

  // Data
  const [catalogItems, setCatalogItems]       = useState([]);
  const [ticketTemplates, setTicketTemplates] = useState([]);
  const [userList, setUserList]               = useState([]);
  const [agentList, setAgentList]             = useState([]);
  const [groupList, setGroupList]             = useState([]);
  const [assetList, setAssetList]             = useState([]);
  const [customFields, setCustomFields]       = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');

  // KB suggestions + duplicate detection
  const [kbSuggestions, setKbSuggestions]   = useState([]);
  const [duplicates, setDuplicates]         = useState([]);
  const [showKB, setShowKB]                 = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  // Form validation errors
  const [errors, setErrors] = useState({});

  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  useEffect(() => {
    apiFetch('/catalog/', token).then(d => setCatalogItems(Array.isArray(d) ? d : [])).catch(() => {});
    apiFetch('/ticket-templates/', token).then(d => setTicketTemplates(Array.isArray(d) ? d : [])).catch(() => {});
    apiFetch('/admin/custom-fields', token).then(d => setCustomFields(Array.isArray(d) ? d : [])).catch(() => {});
    if (isAgentOrAdmin) {
      apiFetch('/users/', token).then(d => {
        const users = Array.isArray(d) ? d : (d.items ?? []);
        setUserList(users);
        setAgentList(users.filter(u => ['agent','admin','super_admin'].includes(u.role)));
      }).catch(() => {});
      apiFetch('/groups/', token).then(d => setGroupList(Array.isArray(d) ? d : [])).catch(() => {});
      apiFetch('/assets/?limit=100', token).then(d => {
        const items = d.items ?? (Array.isArray(d) ? d : []);
        setAssetList(items);
      }).catch(() => {});
    }
  }, [token]);

  // Auto-fill from catalog item
  useEffect(() => {
    if (!catalogItemId) return;
    fetch(`${API}/catalog/${catalogItemId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(data => {
        if (data?.name) {
          setTitle(data.ticket_title || data.name);
          setDescription(data.ticket_description || data.description || '');
          setCategory(data.category || '');
          setTicketType('service_request');
        }
      }).catch(() => {});
  }, [catalogItemId, token]);

  // KB suggestions — debounced on title change
  const fetchKBSuggestions = useCallback(async (q) => {
    if (!q || q.length < 5) { setKbSuggestions([]); return; }
    try {
      const data = await apiFetch(`/kb/articles/?search=${encodeURIComponent(q)}&limit=4`, token);
      setKbSuggestions(data.items ?? []);
    } catch { setKbSuggestions([]); }
  }, [token]);

  // Duplicate detection — debounced on title change
  const detectDuplicates = useCallback(async (q) => {
    if (!q || q.length < 8) { setDuplicates([]); return; }
    try {
      const data = await apiFetch(`/tickets/?search=${encodeURIComponent(q)}&limit=3`, token);
      const items = data.items ?? [];
      setDuplicates(items.filter(t => t.status !== 'closed' && t.status !== 'resolved'));
    } catch { setDuplicates([]); }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchKBSuggestions(title);
      detectDuplicates(title);
    }, 500);
    return () => clearTimeout(timer);
  }, [title]);

  const applyTemplate = (tmpl) => {
    setSelectedTemplate(tmpl.id);
    if (tmpl.title)       setTitle(tmpl.title);
    if (tmpl.description) setDescription(tmpl.description);
    if (tmpl.category)    setCategory(tmpl.category);
    if (tmpl.priority)    setPriority(tmpl.priority);
    if (tmpl.ticket_type) setTicketType(tmpl.ticket_type);
    if (tmpl.tags?.length) setTags(tmpl.tags);
  };

  const applyCatalogItem = (item) => {
    if (item.ticket_title || item.name) setTitle(item.ticket_title || item.name);
    if (item.ticket_description || item.description) setDescription(item.ticket_description || item.description || '');
    if (item.category) setCategory(item.category);
    if (item.priority) setPriority(item.priority);
    setTicketType(item.ticket_type || 'service_request');
  };

  const toggleWatcher = (uid) => setWatcherIds(prev =>
    prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
  );

  const validate = () => {
    const errs = {};
    if (!title.trim())       errs.title = 'Title is required';
    if (!description.trim()) errs.description = 'Description is required';
    if (!category)           errs.category = 'Please select a category';
    // Custom required fields
    customFields.filter(f => f.is_required).forEach(f => {
      if (!customFieldValues[f.field_key]) errs[f.field_key] = `${f.name} is required`;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) { toast.error('Please fill in all required fields'); return; }
    setSubmitting(true);
    try {
      const body = {
        title, description, priority, ticket_type: ticketType, category, tags,
        due_date: dueDate || null,
        custom_fields_data: Object.keys(customFieldValues).length ? customFieldValues : null,
      };
      if (onBehalfOf)      body.on_behalf_of_id    = parseInt(onBehalfOf);
      if (assignedAgentId) body.assigned_to_id      = parseInt(assignedAgentId);
      if (groupId)         body.group_id            = parseInt(groupId);
      if (relatedAssetId)  body.asset_id            = parseInt(relatedAssetId);
      if (impact)          body.impact              = impact;
      if (urgency)         body.urgency             = urgency;

      const res = await fetch(`${API}/tickets/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Failed'); }
      const ticket = await res.json();

      // Add watchers
      if (watcherIds.length > 0) {
        await Promise.allSettled(watcherIds.map(uid =>
          apiFetch(`/tickets/${ticket.id}/watch`, token, { method: 'POST', body: JSON.stringify({ user_id: uid }) })
        ));
      }

      // Attach files
      if (files.length > 0) {
        const failed = [];
        for (const file of files) {
          const fd = new FormData(); fd.append('file', file);
          const r = await fetch(`${API}/tickets/${ticket.id}/attachments`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
          });
          if (!r.ok) failed.push(file.name);
        }
        if (failed.length > 0) toast.error(`Some files failed: ${failed.join(', ')}`);
      }

      toast.success('Ticket created successfully!');
      navigate(`/tickets/${ticket.id}`);
    } catch(err) { toast.error(err.message || 'Failed to create ticket.'); setSubmitting(false); }
  };

  const handleFileChange  = (e) => { setFiles(prev => [...prev, ...Array.from(e.target.files)]); e.target.value = null; };
  const handleDrop        = (e) => { e.preventDefault(); setDragOver(false); setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); };
  const removeFile        = (idx) => setFiles(prev => prev.filter((_,i) => i !== idx));
  const fmtSize           = (b) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;
  const addTag            = () => { const tag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g,''); if (tag && !tags.includes(tag)) { setTags([...tags, tag]); } setTagInput(''); };

  const inp  = "w-full border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const err  = (k) => errors[k] ? "border-red-400 dark:border-red-500" : "border-gray-300 dark:border-gray-600";
  const lbl  = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const req  = <span className="text-red-500 ml-0.5">*</span>;
  const card = "bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-5";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('common.newTicket')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('ticket.incidentExplanation')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Main form ── */}
          <div className="lg:col-span-2 space-y-5">
            <form onSubmit={handleSubmit}>

              {/* Ticket type */}
              <div className={card}>
                <div>
                  <label className={lbl}>{t('ticket.type')}</label>
                  <div className="flex rounded-xl bg-gray-100 dark:bg-gray-700 p-1">
                    {[['incident','🚨','Incident','Something is broken or unavailable'],['service_request','📋','Service Request','Request something new or a change']].map(([val,icon,name,hint]) => (
                      <button key={val} type="button" onClick={() => setTicketType(val)}
                              className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition text-left ${ticketType===val ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                        <span className="font-semibold">{icon} {name}</span>
                        <span className="block text-xs text-gray-400 mt-0.5 font-normal">{hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ticket templates */}
                {ticketTemplates.length > 0 && (
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl">
                    <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mb-2">📋 Use a template</p>
                    <div className="flex flex-wrap gap-2">
                      {ticketTemplates.map(tmpl => (
                        <button key={tmpl.id} type="button" onClick={() => applyTemplate(tmpl)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${selectedTemplate===tmpl.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'}`}>
                          {tmpl.name}
                        </button>
                      ))}
                      {selectedTemplate && <button type="button" onClick={() => setSelectedTemplate('')} className="text-xs text-gray-400 hover:text-gray-600 px-1">✕ Clear</button>}
                    </div>
                  </div>
                )}

                {/* Service catalog chips */}
                {catalogItems.length > 0 && ticketType === 'service_request' && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">⚡ Quick start from Service Catalog</p>
                    <div className="flex flex-wrap gap-2">
                      {catalogItems.filter(i => i.is_featured).slice(0,6).map(item => (
                        <button key={item.id} type="button" onClick={() => applyCatalogItem(item)}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 transition flex items-center gap-1.5">
                          {item.icon || '📦'} {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* On behalf of */}
                {isAgentOrAdmin && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700">
                    <label className={lbl + " text-blue-700 dark:text-blue-300"}>👤 Log on behalf of</label>
                    <select value={onBehalfOf} onChange={e => setOnBehalfOf(e.target.value)} className={inp + " border-blue-300 dark:border-blue-600"}>
                      <option value="">Myself ({user?.full_name})</option>
                      {['admin','agent','employee'].map(role => {
                        const group = userList.filter(u => u.id !== user?.id && u.role === role);
                        if (!group.length) return null;
                        return <optgroup key={role} label={role.charAt(0).toUpperCase()+role.slice(1)+'s'}>{group.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}</optgroup>;
                      })}
                    </select>
                  </div>
                )}
              </div>

              {/* Core fields */}
              <div className={card}>
                {/* Title with KB suggestions + duplicate detection */}
                <div>
                  <label className={lbl}>{t('ticket.title')}{req}</label>
                  <input type="text" value={title} onChange={e => { setTitle(e.target.value); setErrors(er => ({...er, title: ''})); }}
                         className={`${inp} ${err('title')}`} placeholder="Brief description of the issue..." />
                  {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}

                  {/* Duplicate detection */}
                  {duplicates.length > 0 && (
                    <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                      <button type="button" onClick={() => setShowDuplicates(!showDuplicates)}
                              className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400 w-full text-left">
                        ⚠️ {duplicates.length} similar open ticket{duplicates.length > 1 ? 's' : ''} found — check before submitting
                        <span className="ml-auto">{showDuplicates ? '▲' : '▼'}</span>
                      </button>
                      {showDuplicates && (
                        <div className="mt-2 space-y-1">
                          {duplicates.map(t => (
                            <a key={t.id} href={`/tickets/${t.id}`} target="_blank" rel="noreferrer"
                               className="block text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                              #{t.id} — {t.title} <span className="text-gray-400">({t.status})</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* KB suggestions */}
                  {kbSuggestions.length > 0 && (
                    <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
                      <button type="button" onClick={() => setShowKB(!showKB)}
                              className="flex items-center gap-2 text-xs font-medium text-green-700 dark:text-green-400 w-full text-left">
                        📚 {kbSuggestions.length} KB article{kbSuggestions.length > 1 ? 's' : ''} might help — check before submitting
                        <span className="ml-auto">{showKB ? '▲' : '▼'}</span>
                      </button>
                      {showKB && (
                        <div className="mt-2 space-y-1">
                          {kbSuggestions.map(a => (
                            <a key={a.id} href={`/kb/${a.id}`} target="_blank" rel="noreferrer"
                               className="block text-xs text-green-700 dark:text-green-400 hover:underline">
                              📄 {a.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Description */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={lbl}>{t('ticket.description')}{req}</label>
                    <span className="text-xs text-gray-400">{description.split(/\s+/).filter(Boolean).length} words</span>
                  </div>
                  <textarea value={description} onChange={e => { setDescription(e.target.value); setErrors(er => ({...er, description: ''})); }}
                            rows={6} className={`${inp} resize-none ${err('description')}`}
                            placeholder="Describe the issue in detail. Include: what happened, when it started, error messages, steps to reproduce..." />
                  {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
                </div>

                {/* Category + Priority */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>{t('ticket.category')}{req}</label>
                    <select value={category} onChange={e => { setCategory(e.target.value); setErrors(er => ({...er, category: ''})); }}
                            className={`${inp} ${err('category')}`}>
                      <option value="">— Select Category —</option>
                      {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category}</p>}
                  </div>
                  <div>
                    <label className={lbl}>{t('ticket.priority')}</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)} className={inp + " border-gray-300 dark:border-gray-600"}>
                      {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label} — {p.desc}</option>)}
                    </select>
                  </div>
                </div>

                {/* ITIL impact + urgency for incidents */}
                {ticketType === 'incident' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={lbl}>Impact <span className="text-gray-400 font-normal">(optional)</span></label>
                      <select value={impact} onChange={e => setImpact(e.target.value)} className={inp + " border-gray-300 dark:border-gray-600"}>
                        <option value="">Select impact...</option>
                        {IMPACT_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lbl}>Urgency <span className="text-gray-400 font-normal">(optional)</span></label>
                      <select value={urgency} onChange={e => setUrgency(e.target.value)} className={inp + " border-gray-300 dark:border-gray-600"}>
                        <option value="">Select urgency...</option>
                        {URGENCY_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* Tags */}
                <div>
                  <label className={lbl}>Tags <span className="text-gray-400 font-normal">(optional)</span></label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {tags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                        #{tag}
                        <button type="button" onClick={() => setTags(tags.filter(t => t !== tag))} className="hover:text-red-500">✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                           onKeyDown={e => { if (e.key==='Enter'||e.key===',') { e.preventDefault(); addTag(); }}}
                           placeholder="Type tag name and press Enter or comma..."
                           className={`${inp} border-gray-300 dark:border-gray-600 flex-1`} />
                    <button type="button" onClick={addTag}
                            className="px-3 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-sm hover:bg-indigo-200 transition">
                      Add
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Tip: press Enter or comma to add. Tags are lowercase, letters/numbers/hyphens only.</p>
                </div>

                {/* Custom fields */}
                {customFields.length > 0 && (
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">🗂 Additional Information</p>
                    <div className="grid grid-cols-2 gap-4">
                      {customFields.filter(f => f.applies_to === 'all' || f.applies_to === ticketType).map(field => (
                        <div key={field.id} className={field.field_type === 'checkbox' ? '' : ''}>
                          <label className={lbl}>{field.name}{field.is_required && req}</label>
                          {field.field_type === 'text' && (
                            <input type="text" value={customFieldValues[field.field_key]||''} onChange={e => setCustomFieldValues(v=>({...v,[field.field_key]:e.target.value}))} className={`${inp} ${err(field.field_key)} border-gray-300 dark:border-gray-600`} />
                          )}
                          {field.field_type === 'number' && (
                            <input type="number" value={customFieldValues[field.field_key]||''} onChange={e => setCustomFieldValues(v=>({...v,[field.field_key]:e.target.value}))} className={`${inp} ${err(field.field_key)} border-gray-300 dark:border-gray-600`} />
                          )}
                          {field.field_type === 'date' && (
                            <input type="date" value={customFieldValues[field.field_key]||''} onChange={e => setCustomFieldValues(v=>({...v,[field.field_key]:e.target.value}))} className={`${inp} ${err(field.field_key)} border-gray-300 dark:border-gray-600`} />
                          )}
                          {field.field_type === 'checkbox' && (
                            <label className="flex items-center gap-2 cursor-pointer mt-1"><input type="checkbox" checked={!!customFieldValues[field.field_key]} onChange={e => setCustomFieldValues(v=>({...v,[field.field_key]:e.target.checked}))} className="rounded" /><span className="text-sm text-gray-600 dark:text-gray-300">Yes</span></label>
                          )}
                          {field.field_type === 'dropdown' && (
                            <select value={customFieldValues[field.field_key]||''} onChange={e => setCustomFieldValues(v=>({...v,[field.field_key]:e.target.value}))} className={`${inp} ${err(field.field_key)} border-gray-300 dark:border-gray-600`}>
                              <option value="">Select...</option>
                              {(field.options||[]).map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          )}
                          {errors[field.field_key] && <p className="text-red-500 text-xs mt-1">{errors[field.field_key]}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Attachments */}
              <div className={card}>
                <label className={lbl}>{t('ticket.attachments')} <span className="text-gray-400 font-normal">(optional)</span></label>
                <div className={`border-2 border-dashed rounded-xl p-6 text-center transition ${dragOver ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'}`}
                     onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
                  <svg className="mx-auto h-10 w-10 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <label className="cursor-pointer text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium">
                    Click to upload
                    <input type="file" multiple onChange={handleFileChange} accept=".txt,.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.zip,.pptx,.log,.mp4" className="sr-only" />
                  </label>
                  <span className="text-sm text-gray-500 dark:text-gray-400"> or drag and drop</span>
                  <p className="text-xs text-gray-400 mt-1">PNG, JPG, PDF, DOCX, XLSX, ZIP up to 10MB each</p>
                </div>
                {files.length > 0 && (
                  <div className="space-y-2 mt-3">
                    {files.map((f,i) => (
                      <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-400">📎</span>
                          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{f.name}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">({fmtSize(f.size)})</span>
                        </div>
                        <button type="button" onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 ml-2 flex-shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit */}
              <div className="flex items-center justify-between pt-2">
                <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">← {t('common.cancel')}</Link>
                <button type="submit" disabled={submitting}
                        className="bg-indigo-600 text-white px-8 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm">
                  {submitting ? '⏳ Submitting...' : `✅ ${t('ticket.submitTicket')}`}
                </button>
              </div>
            </form>
          </div>

          {/* ── Right sidebar ── */}
          <div className="space-y-5">
            {/* Agent options */}
            {isAgentOrAdmin && (
              <div className={card.replace('space-y-5','space-y-4')}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">⚙️ Agent Options</h3>

                <div>
                  <label className={lbl}>Assign to Group</label>
                  <select value={groupId} onChange={e => { setGroupId(e.target.value); setAssignedAgentId(''); }} className={inp + " border-gray-300 dark:border-gray-600"}>
                    <option value="">No group</option>
                    {groupList.map(g => <option key={g.id} value={g.id}>{g.name} ({g.member_count || 0} members)</option>)}
                  </select>
                </div>

                <div>
                  <label className={lbl}>Assign to Agent</label>
                  <select value={assignedAgentId} onChange={e => setAssignedAgentId(e.target.value)} className={inp + " border-gray-300 dark:border-gray-600"}>
                    <option value="">
                      {groupId
                        ? `Auto-assign within ${groupList.find(g=>g.id===parseInt(groupId))?.name || 'group'}`
                        : 'Auto-assign (round-robin)'}
                    </option>
                    {/* If a group is selected, only show agents in that group */}
                    {(groupId
                      ? (groupList.find(g => g.id === parseInt(groupId))?.members || [])
                      : agentList
                    ).map(a => {
                      const dot = { online:'🟢', busy:'🟡', away:'🟠', offline:'⚫' }[a.availability] || '⚫';
                      return <option key={a.id} value={a.id}>{dot} {a.full_name}</option>;
                    })}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    {assignedAgentId
                      ? '✓ Will be assigned directly to this agent'
                      : '↻ Auto-assign picks the agent with the fewest open tickets'}
                  </p>
                </div>

                <div>
                  <label className={lbl}>Due Date</label>
                  <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inp + " border-gray-300 dark:border-gray-600"} />
                </div>

                <div>
                  <label className={lbl}>Related Asset</label>
                  <select value={relatedAssetId} onChange={e => setRelatedAssetId(e.target.value)} className={inp + " border-gray-300 dark:border-gray-600"}>
                    <option value="">No asset</option>
                    {assetList.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                  </select>
                </div>

                <div>
                  <label className={lbl}>Add Watchers</label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                    {agentList.filter(a => a.id !== user?.id).map(a => (
                      <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={watcherIds.includes(a.id)} onChange={() => toggleWatcher(a.id)} className="rounded border-gray-300" />
                        <span className="text-xs text-gray-700 dark:text-gray-300">{a.full_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tips */}
            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300 mb-2">💡 Before you submit</h3>
              <p className="text-sm text-indigo-700 dark:text-indigo-400 mb-3">Check the <Link to="/kb" className="underline font-medium">Knowledge Base</Link> — your answer might already be there.</p>
              <ul className="space-y-2 text-xs text-indigo-600 dark:text-indigo-400">
                <li>✓ Include error messages and screenshots</li>
                <li>✓ Note when the issue started</li>
                <li>✓ Describe steps to reproduce</li>
                <li>✓ Mark Critical only for service outages</li>
              </ul>
            </div>

            {/* Priority guide */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Priority Guide</h3>
              <div className="space-y-2">
                {PRIORITIES.map(p => (
                  <div key={p.value} className="flex items-start gap-2">
                    <span className="text-xs mt-0.5">{p.label.split(' ')[0]}</span>
                    <div>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{p.label.split(' ').slice(1).join(' ')}</span>
                      <p className="text-xs text-gray-400">{p.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
