import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from '../../i18n/I18nContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

// ── Constants ──────────────────────────────────────────────────────────────

const TRIGGERS = [
  { value: 'on_create',        label: '🎫 When a ticket is created' },
  { value: 'on_update',        label: '✏️ When a ticket is updated' },
  { value: 'on_status_change', label: '🔄 When status changes' },
  { value: 'time_based',       label: '⏰ On a schedule (every 30 min)' },
];

const CONDITION_FIELDS = [
  { value: 'priority',            label: 'Priority',              operators: ['is','is_not'], values: ['low','medium','high','critical'] },
  { value: 'status',              label: 'Status',                operators: ['is','is_not'], values: ['open','in_progress','resolved','closed'] },
  { value: 'ticket_type',         label: 'Ticket Type',           operators: ['is','is_not'], values: ['incident','service_request','change'] },
  { value: 'category',            label: 'Category',              operators: ['is','is_not','contains'], values: [] },
  { value: 'tag',                 label: 'Tag',                   operators: ['contains'],    values: [] },
  { value: 'assigned_to',         label: 'Assigned To (user ID)', operators: ['is','is_empty','is_not_empty'], values: [] },
  { value: 'hours_since_update',  label: 'Hours since last update (time-based)', operators: ['is'], values: [] },
  { value: 'hours_since_created', label: 'Hours since created (time-based)',     operators: ['is'], values: [] },
];

const ACTION_TYPES = [
  { value: 'assign_to',       label: '👤 Assign to agent',    needsValue: true },
  { value: 'assign_to_group', label: '👥 Assign to group',    needsValue: true },
  { value: 'set_priority',    label: '🔺 Set priority',       needsValue: true, options: ['low','medium','high','critical'] },
  { value: 'set_status',      label: '🔄 Set status',         needsValue: true, options: ['open','in_progress','resolved','closed'] },
  { value: 'add_tag',         label: '🏷️ Add tag',             needsValue: true },
  { value: 'add_comment',     label: '💬 Add internal note',  needsValue: true },
  { value: 'close_ticket',    label: '✅ Close ticket',       needsValue: false },
];

const OPERATORS = {
  is: 'is', is_not: 'is not', contains: 'contains', is_empty: 'is empty', is_not_empty: 'is not empty'
};

const EMPTY_RULE = { name: '', description: '', trigger: 'on_create', is_active: true, conditions: [], actions: [] };
const EMPTY_COND = { field: 'priority', operator: 'is', value: 'high' };
const EMPTY_ACTION = { action: 'assign_to', value: '' };

// ── Component ───────────────────────────────────────────────────────────────

export default function AutomationRulesTab() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_RULE);
  const [saving, setSaving] = useState(false);
  const [testTicketId, setTestTicketId] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const fetchRules = () => {
    apiFetch('/admin/automation-rules', token)
      .then(data => setRules(Array.isArray(data) ? data : []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    fetchRules();
    apiFetch('/admin/users?role=agent&limit=200', token).then(d => setAgents(d.items ?? [])).catch(() => {});
    apiFetch('/groups/', token).then(d => setGroups(Array.isArray(d) ? d : [])).catch(() => {});
  }, [token]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Rule name is required'); return; }
    if (!form.actions.length) { toast.error('At least one action is required'); return; }
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/admin/automation-rules/${editingId}`, token, { method: 'PATCH', body: JSON.stringify(form) });
        toast.success('Rule updated');
      } else {
        await apiFetch('/admin/automation-rules', token, { method: 'POST', body: JSON.stringify(form) });
        toast.success('Rule created');
      }
      setShowForm(false); setEditingId(null); setForm(EMPTY_RULE);
      fetchRules();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleToggle = async (rule) => {
    await apiFetch(`/admin/automation-rules/${rule.id}`, token, {
      method: 'PATCH', body: JSON.stringify({ is_active: !rule.is_active })
    });
    fetchRules();
  };

  const handleDelete = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    await apiFetch(`/admin/automation-rules/${rule.id}`, token, { method: 'DELETE' });
    toast.success('Rule deleted');
    fetchRules();
  };

  const handleEdit = (rule) => {
    setForm({ name: rule.name, description: rule.description || '', trigger: rule.trigger,
              is_active: rule.is_active, conditions: rule.conditions, actions: rule.actions });
    setEditingId(rule.id);
    setShowForm(true);
    setExpandedId(null);
  };

  const handleTest = async (rule) => {
    if (!testTicketId) { toast.error('Enter a ticket ID to test against'); return; }
    const raw = testTicketId.trim().toUpperCase().replace(/^(INC|REQ|CHG)0*/,'');
    const numId = parseInt(raw);
    if (isNaN(numId)) { toast.error('Invalid ticket reference'); return; }
    setTestingId(rule.id);
    try {
      const result = await apiFetch(`/admin/automation-rules/${rule.id}/test`, token, {
        method: 'POST', body: JSON.stringify({ ticket_id: numId })
      });
      setTestResult({ ruleId: rule.id, ...result });
    } catch (err) { toast.error(err.message); }
    finally { setTestingId(null); }
  };

  // ── Condition / Action builders ──────────────────────────────────────────

  const updateCond = (i, key, val) => {
    const c = [...form.conditions]; c[i] = { ...c[i], [key]: val };
    if (key === 'field') { c[i].operator = CONDITION_FIELDS.find(f=>f.value===val)?.operators[0] || 'is'; c[i].value = ''; }
    setForm({...form, conditions: c});
  };
  const removeCond = i => setForm({...form, conditions: form.conditions.filter((_,idx)=>idx!==i)});
  const updateAction = (i, key, val) => {
    const a = [...form.actions]; a[i] = { ...a[i], [key]: val };
    if (key === 'action') a[i].value = '';
    setForm({...form, actions: a});
  };
  const removeAction = i => setForm({...form, actions: form.actions.filter((_,idx)=>idx!==i)});

  const condField = (f) => CONDITION_FIELDS.find(x => x.value === f);
  const actionType = (a) => ACTION_TYPES.find(x => x.value === a);

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const inputClass = "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const selectClass = inputClass;

  return (
    <div>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Automation Rules</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Auto-assign, tag, escalate or close tickets based on conditions</p>
          </div>
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_RULE); }}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
            + New Rule
          </button>
        </div>

        {/* Rule Form */}
        {showForm && (
          <div className={`${cardClass} mb-6 border-indigo-200 dark:border-indigo-700`}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-5">{editingId ? 'Edit Rule' : 'New Rule'}</h3>
            <div className="space-y-5">

              {/* Name + Active */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Rule Name *</label>
                  <input type="text" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}
                         placeholder="e.g. Auto-assign critical tickets" className={inputClass + " w-full"} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" checked={form.is_active} onChange={e=>setForm({...form,is_active:e.target.checked})}
                           className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
                  </label>
                </div>
              </div>

              {/* Trigger */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Trigger *</label>
                <div className="grid grid-cols-2 gap-2">
                  {TRIGGERS.map(tr => (
                    <label key={tr.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition ${form.trigger===tr.value ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                      <input type="radio" value={tr.value} checked={form.trigger===tr.value} onChange={()=>setForm({...form,trigger:tr.value})} className="sr-only" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{tr.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Conditions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Conditions <span className="font-normal text-gray-400">(all must match — leave empty to match all tickets)</span></label>
                  <button type="button" onClick={()=>setForm({...form,conditions:[...form.conditions,{...EMPTY_COND}]})}
                          className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 dark:border-indigo-700 px-2 py-1 rounded-lg">+ Add condition</button>
                </div>
                {form.conditions.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No conditions — rule will apply to all tickets</p>
                ) : (
                  <div className="space-y-2">
                    {form.conditions.map((cond, i) => {
                      const cf = condField(cond.field);
                      return (
                        <div key={i} className="flex items-center gap-2 flex-wrap bg-gray-50 dark:bg-gray-700/50 p-2 rounded-lg">
                          <select value={cond.field} onChange={e=>updateCond(i,'field',e.target.value)} className={selectClass}>
                            {CONDITION_FIELDS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                          </select>
                          <select value={cond.operator} onChange={e=>updateCond(i,'operator',e.target.value)} className={selectClass}>
                            {(cf?.operators||['is']).map(op=><option key={op} value={op}>{OPERATORS[op]||op}</option>)}
                          </select>
                          {!['is_empty','is_not_empty'].includes(cond.operator) && (
                            cf?.values?.length > 0 ? (
                              <select value={cond.value} onChange={e=>updateCond(i,'value',e.target.value)} className={selectClass}>
                                {cf.values.map(v=><option key={v} value={v}>{v}</option>)}
                              </select>
                            ) : (
                              <input type="text" value={cond.value} onChange={e=>updateCond(i,'value',e.target.value)}
                                     placeholder="value" className={inputClass + " flex-1 min-w-[120px]"} />
                            )
                          )}
                          <button onClick={()=>removeCond(i)} className="text-gray-400 hover:text-red-500 ml-auto">✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Actions * <span className="font-normal text-gray-400">(executed in order when conditions match)</span></label>
                  <button type="button" onClick={()=>setForm({...form,actions:[...form.actions,{...EMPTY_ACTION}]})}
                          className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 dark:border-indigo-700 px-2 py-1 rounded-lg">+ Add action</button>
                </div>
                {form.actions.length === 0 ? (
                  <p className="text-xs text-red-400 italic">At least one action is required</p>
                ) : (
                  <div className="space-y-2">
                    {form.actions.map((act, i) => {
                      const at = actionType(act.action);
                      return (
                        <div key={i} className="flex items-center gap-2 flex-wrap bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded-lg">
                          <select value={act.action} onChange={e=>updateAction(i,'action',e.target.value)} className={selectClass}>
                            {ACTION_TYPES.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                          {at?.needsValue && (
                            at?.options ? (
                              <select value={act.value} onChange={e=>updateAction(i,'value',e.target.value)} className={selectClass}>
                                <option value="">Select...</option>
                                {at.options.map(o=><option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : act.action === 'assign_to' ? (
                              <select value={act.value} onChange={e=>updateAction(i,'value',e.target.value)} className={selectClass}>
                                <option value="">Select agent...</option>
                                {agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
                              </select>
                            ) : act.action === 'assign_to_group' ? (
                              <select value={act.value} onChange={e=>updateAction(i,'value',e.target.value)} className={selectClass}>
                                <option value="">Select group...</option>
                                {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                              </select>
                            ) : (
                              <input type="text" value={act.value} onChange={e=>updateAction(i,'value',e.target.value)}
                                     placeholder={act.action==='add_comment' ? 'Comment text...' : act.action==='add_tag' ? 'tag-name' : 'value'}
                                     className={inputClass + " flex-1 min-w-[160px]"} />
                            )
                          )}
                          <button onClick={()=>removeAction(i)} className="text-gray-400 hover:text-red-500 ml-auto">✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                <button onClick={handleSave} disabled={saving} className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition">
                  {saving ? 'Saving...' : editingId ? 'Update Rule' : 'Create Rule'}
                </button>
                <button onClick={()=>{setShowForm(false);setEditingId(null);}} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-5 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rules List */}
        {loading ? (
          <div className={`${cardClass} text-center py-10`}><p className="text-gray-400">{t('common.loading')}</p></div>
        ) : rules.length === 0 ? (
          <div className={`${cardClass} text-center py-12`}>
            <p className="text-4xl mb-3">⚙️</p>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No automation rules yet</p>
            <p className="text-sm text-gray-400 mt-1">Create rules to automatically assign, tag, or update tickets</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map(rule => (
              <div key={rule.id} className={`${cardClass} ${!rule.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  {/* Toggle */}
                  <button onClick={() => handleToggle(rule)} title={rule.is_active ? 'Disable' : 'Enable'}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 mt-0.5 cursor-pointer rounded-full border-2 border-transparent transition-colors ${rule.is_active ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-600'}`}>
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${rule.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-800 dark:text-white">{rule.name}</h3>
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">
                        {TRIGGERS.find(t=>t.value===rule.trigger)?.label || rule.trigger}
                      </span>
                      {rule.run_count > 0 && (
                        <span className="text-xs text-green-600 dark:text-green-400">▶ ran {rule.run_count}×</span>
                      )}
                    </div>
                    {rule.description && <p className="text-xs text-gray-400 mt-0.5">{rule.description}</p>}

                    {/* Expandable details */}
                    <button onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                            className="text-xs text-indigo-500 hover:underline mt-1.5">
                      {expandedId === rule.id ? '▲ Hide details' : `▼ ${rule.conditions.length} condition${rule.conditions.length!==1?'s':''}, ${rule.actions.length} action${rule.actions.length!==1?'s':''}`}
                    </button>

                    {expandedId === rule.id && (
                      <div className="mt-3 space-y-3">
                        {rule.conditions.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">IF (all match)</p>
                            {rule.conditions.map((c,i) => (
                              <div key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1.5 mb-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0"></span>
                                <span className="font-medium">{condField(c.field)?.label || c.field}</span>
                                <span className="text-gray-400">{OPERATORS[c.operator]||c.operator}</span>
                                <span className="font-medium text-indigo-600 dark:text-indigo-400">{c.value || '—'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">THEN</p>
                          {rule.actions.map((a,i) => (
                            <div key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1.5 mb-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0"></span>
                              <span>{actionType(a.action)?.label || a.action}</span>
                              {a.value && <span className="font-medium text-green-600 dark:text-green-400">→ {a.value}</span>}
                            </div>
                          ))}
                        </div>

                        {/* Test panel */}
                        <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                          <input type="text" value={testTicketId} onChange={e=>setTestTicketId(e.target.value)}
                                 placeholder="Test on ticket (e.g. INC000001)" className={inputClass + " text-xs py-1"} />
                          <button onClick={() => handleTest(rule)} disabled={testingId===rule.id}
                                  className="text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition disabled:opacity-50">
                            {testingId===rule.id ? 'Testing...' : '🧪 Test'}
                          </button>
                        </div>
                        {testResult?.ruleId === rule.id && (
                          <div className={`text-xs p-2 rounded-lg ${testResult.would_fire ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                            {testResult.would_fire ? '✅ Rule WOULD fire on this ticket' : '❌ Rule would NOT fire — conditions not met'}
                            {testResult.condition_results?.map((cr,i) => (
                              <div key={i} className="mt-1">{cr.passed ? '✓' : '✗'} {cr.condition.field} {cr.condition.operator} {cr.condition.value}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => handleEdit(rule)} className="text-indigo-500 hover:text-indigo-700 transition" title="Edit">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113 2.932L7.5 19.785 3 21l1.215-4.5L16.862 4.487z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(rule)} className="text-red-400 hover:text-red-600 transition" title="Delete">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
