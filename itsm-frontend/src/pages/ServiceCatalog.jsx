import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { TICKET_CATEGORIES } from './CreateTicket';

const EMPTY_FORM = {
  name: '', description: '', category: '', icon: '📦',
  estimated_cost: '', delivery_time_days: '', approval_required: true,
  ticket_title: '', ticket_description: '', ticket_type: 'service_request',
  priority: 'medium', is_onboarding: false, onboarding_tasks: [],
  is_featured: false, sort_order: 0, visibility: 'all',
  sla_hours: '', request_form_fields: [], fulfillment_checklist: [],
};

const ICONS = ['📦','💻','🖥️','🖨️','📱','🔑','🌐','📧','🔒','🛠️','📂','🎧','📞','☁️','🚀','📋','🏢','💡','🔧','📊'];
const VISIBILITIES = [
  { value: 'all', label: 'Everyone' },
  { value: 'employees_only', label: 'Employees only' },
  { value: 'agents_only', label: 'Agents & Admins only' },
];

export default function ServiceCatalog() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const isAdmin = ['admin','super_admin'].includes(user?.role);
  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  const [items, setItems]             = useState([]);
  const [categories, setCategories]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [showForm, setShowForm]       = useState(false);
  const [editingId, setEditingId]     = useState(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [activeTab, setActiveTab]     = useState('details'); // details | form_fields | fulfillment
  const [newFormField, setNewFormField] = useState({ label: '', type: 'text', required: false });
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [newTask, setNewTask]         = useState('');

  // Request modal
  const [requestingItem, setRequestingItem] = useState(null);
  const [requestFormValues, setRequestFormValues] = useState({});
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Onboarding modal
  const [onboardingItem, setOnboardingItem] = useState(null);
  const [onboardingForm, setOnboardingForm] = useState({ employee_name:'', employee_email:'', start_date:'', manager_name:'', department:'' });
  const [onboarding, setOnboarding]   = useState(false);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (activeCategory) params.append('category', activeCategory);
      const data = await apiFetch(`/catalog/?${params}`, token);
      setItems(Array.isArray(data) ? data : []);
    } catch(e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const fetchCategories = async () => {
    try {
      const data = await apiFetch('/catalog/categories', token);
      setCategories(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => { fetchItems(); }, [token, search, activeCategory]);
  useEffect(() => { fetchCategories(); }, [token]);

  const openNew  = () => { setForm(EMPTY_FORM); setEditingId(null); setActiveTab('details'); setShowForm(true); };
  const openEdit = (item) => {
    setForm({
      name: item.name, description: item.description||'', category: item.category||'',
      icon: item.icon||'📦', estimated_cost: item.estimated_cost||'',
      delivery_time_days: item.delivery_time_days||'', approval_required: item.approval_required,
      ticket_title: item.ticket_title||'', ticket_description: item.ticket_description||'',
      ticket_type: item.ticket_type||'service_request', priority: item.priority||'medium',
      is_onboarding: item.is_onboarding||false, onboarding_tasks: item.onboarding_tasks||[],
      is_featured: item.is_featured||false, sort_order: item.sort_order||0,
      visibility: item.visibility||'all', sla_hours: item.sla_hours||'',
      request_form_fields: item.request_form_fields||[],
      fulfillment_checklist: item.fulfillment_checklist||[],
    });
    setEditingId(item.id); setActiveTab('details'); setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.category) { toast.error('Category is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : null,
        delivery_time_days: form.delivery_time_days ? parseInt(form.delivery_time_days) : null,
        sort_order: parseInt(form.sort_order)||0, sla_hours: form.sla_hours ? parseInt(form.sla_hours) : null };
      if (editingId) await apiFetch(`/catalog/${editingId}`, token, { method:'PUT', body:JSON.stringify(payload) });
      else await apiFetch('/catalog/', token, { method:'POST', body:JSON.stringify(payload) });
      toast.success('Catalog item saved');
      setShowForm(false); setEditingId(null);
      fetchItems(); fetchCategories();
    } catch(e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this item from the catalog?')) return;
    try { await apiFetch(`/catalog/${id}`, token, { method:'DELETE' }); fetchItems(); } catch(e) { toast.error(e.message); }
  };

  const handleRequest = async () => {
    if (!requestingItem) return;
    setSubmittingRequest(true);
    try {
      const extraInfo = Object.entries(requestFormValues).map(([k,v]) => `${k}: ${v}`).join('\n');
      await apiFetch('/tickets/', token, {
        method: 'POST',
        body: JSON.stringify({
          title: requestingItem.ticket_title || requestingItem.name,
          description: (requestingItem.ticket_description || '') + (extraInfo ? `\n\n--- Additional Info ---\n${extraInfo}` : ''),
          category: requestingItem.category || 'Other',
          priority: requestingItem.priority || 'medium',
          ticket_type: requestingItem.ticket_type || 'service_request',
        })
      });
      toast.success('Request submitted successfully!');
      setRequestingItem(null);
      setRequestFormValues({});
    } catch(e) { toast.error(e.message); }
    finally { setSubmittingRequest(false); }
  };

  const handleOnboard = async () => {
    if (!onboardingItem) return;
    setOnboarding(true);
    try {
      await apiFetch(`/catalog/${onboardingItem.id}/onboard`, token, { method:'POST', body:JSON.stringify(onboardingForm) });
      toast.success('Onboarding tickets created!');
      setOnboardingItem(null);
    } catch(e) { toast.error(e.message); }
    finally { setOnboarding(false); }
  };

  // Group items by category
  const grouped = items.reduce((acc, item) => {
    const cat = item.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const featured = items.filter(i => i.is_featured);

  const inp  = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const lbl  = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700";

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{t('catalog.title')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Request IT services and resources for your team</p>
          </div>
          {isAdmin && (
            <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
              + {t('catalog.newItem')}
            </button>
          )}
        </div>

        {/* Search + Category filter */}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Search catalog..." className={inp + " pl-9"} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setActiveCategory('')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition ${activeCategory==='' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-400'}`}>
              All
            </button>
            {categories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(activeCategory===cat ? '' : cat)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${activeCategory===cat ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-400'}`}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div className={card + " p-12 text-center"}>
            <p className="text-4xl mb-4">📦</p>
            <p className="text-gray-500 dark:text-gray-400">{t('catalog.noItems')}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Featured / Quick Start */}
            {featured.length > 0 && !search && !activeCategory && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">⚡ Quick Start</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {featured.map(item => (
                    <button key={item.id}
                            onClick={() => item.is_onboarding ? setOnboardingItem(item) : setRequestingItem(item)}
                            className={card + " p-4 text-left hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-600 transition cursor-pointer"}>
                      <div className="text-2xl mb-2">{item.icon || '📦'}</div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-white">{item.name}</p>
                      {item.delivery_time_days && <p className="text-xs text-gray-400 mt-1">{item.delivery_time_days}d delivery</p>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Grouped by category */}
            {Object.entries(grouped).map(([category, catItems]) => (
              <div key={category}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{category}</h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {catItems.map(item => (
                    <div key={item.id} className={card + " p-5 flex flex-col"}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{item.icon || '📦'}</span>
                          <div>
                            <h4 className="font-semibold text-gray-800 dark:text-white text-sm">{item.name}</h4>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.estimated_cost && <span className="text-xs text-gray-400">${item.estimated_cost}</span>}
                              {item.delivery_time_days && <span className="text-xs text-gray-400">· {item.delivery_time_days}d</span>}
                              {item.approval_required && <span className="text-xs text-amber-500">· Approval needed</span>}
                            </div>
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => openEdit(item)} className="text-xs text-indigo-500 hover:text-indigo-700 p-1">✏️</button>
                            <button onClick={() => handleDelete(item.id)} className="text-xs text-red-400 hover:text-red-600 p-1">🗑️</button>
                          </div>
                        )}
                      </div>
                      {item.description && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 flex-1 line-clamp-2">{item.description}</p>}
                      {/* Fulfillment checklist preview for agents */}
                      {isAgentOrAdmin && item.fulfillment_checklist?.length > 0 && (
                        <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                          <p className="text-xs font-medium text-gray-500 mb-1">Fulfillment checklist ({item.fulfillment_checklist.length} steps)</p>
                          {item.fulfillment_checklist.slice(0,2).map((step,i) => (
                            <p key={i} className="text-xs text-gray-400">☐ {step}</p>
                          ))}
                          {item.fulfillment_checklist.length > 2 && <p className="text-xs text-gray-400">+{item.fulfillment_checklist.length-2} more</p>}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-auto">
                        {item.request_count > 0 && <span className="text-xs text-gray-400">🔥 {item.request_count} requests</span>}
                        {item.sla_hours && <span className="text-xs text-blue-500">SLA: {item.sla_hours}h</span>}
                        <button onClick={() => item.is_onboarding ? setOnboardingItem(item) : setRequestingItem(item)}
                                className="ml-auto bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 transition">
                          {item.is_onboarding ? t('catalog.startOnboarding') : t('catalog.request')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Request Modal ── */}
        {requestingItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-3xl">{requestingItem.icon || '📦'}</span>
                  <h3 className="text-lg font-bold text-gray-800 dark:text-white">{requestingItem.name}</h3>
                </div>
                {requestingItem.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{requestingItem.description}</p>}
                {(requestingItem.estimated_cost || requestingItem.delivery_time_days) && (
                  <div className="flex gap-4 mt-3">
                    {requestingItem.estimated_cost && <span className="text-sm text-gray-600 dark:text-gray-300">💰 Est. cost: <strong>${requestingItem.estimated_cost}</strong></span>}
                    {requestingItem.delivery_time_days && <span className="text-sm text-gray-600 dark:text-gray-300">📅 Delivery: <strong>{requestingItem.delivery_time_days} days</strong></span>}
                  </div>
                )}
                {requestingItem.approval_required && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">⚠️ This request requires approval before fulfillment</p>
                )}
              </div>
              <div className="p-6 space-y-4">
                {/* Custom request form fields */}
                {requestingItem.request_form_fields?.length > 0 && (
                  <div className="space-y-3">
                    {requestingItem.request_form_fields.map((field, i) => (
                      <div key={i}>
                        <label className={lbl}>{field.label}{field.required && <span className="text-red-500 ml-1">*</span>}</label>
                        {field.type === 'text' && (
                          <input type="text" value={requestFormValues[field.label]||''}
                                 onChange={e => setRequestFormValues(v=>({...v,[field.label]:e.target.value}))}
                                 className={inp} />
                        )}
                        {field.type === 'textarea' && (
                          <textarea rows={2} value={requestFormValues[field.label]||''}
                                    onChange={e => setRequestFormValues(v=>({...v,[field.label]:e.target.value}))}
                                    className={inp} />
                        )}
                        {field.type === 'date' && (
                          <input type="date" value={requestFormValues[field.label]||''}
                                 onChange={e => setRequestFormValues(v=>({...v,[field.label]:e.target.value}))}
                                 className={inp} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {requestingItem.request_form_fields?.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Click Submit to raise this service request.</p>
                )}
              </div>
              <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button onClick={handleRequest} disabled={submittingRequest}
                        className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                  {submittingRequest ? 'Submitting...' : 'Submit Request'}
                </button>
                <button onClick={() => { setRequestingItem(null); setRequestFormValues({}); }}
                        className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Onboarding Modal ── */}
        {onboardingItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">🚀 {onboardingItem.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Fill in new joiner details to create onboarding tickets</p>
              </div>
              <div className="p-6 space-y-3">
                {[['employee_name','Employee Name'],['employee_email','Employee Email'],['start_date','Start Date'],['manager_name','Manager Name'],['department','Department']].map(([key, label]) => (
                  <div key={key}>
                    <label className={lbl}>{label}</label>
                    <input type={key==='employee_email'?'email':key==='start_date'?'date':'text'}
                           value={onboardingForm[key]} onChange={e=>setOnboardingForm(f=>({...f,[key]:e.target.value}))}
                           className={inp} />
                  </div>
                ))}
              </div>
              <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button onClick={handleOnboard} disabled={onboarding}
                        className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                  {onboarding ? 'Creating tickets...' : 'Start Onboarding'}
                </button>
                <button onClick={() => setOnboardingItem(null)}
                        className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-200 transition">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Admin Edit Form ── */}
        {showForm && isAdmin && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl my-4">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-800 dark:text-white">{editingId ? t('catalog.editItem') : t('catalog.newItem')}</h3>
              </div>

              {/* Tab nav */}
              <div className="flex gap-1 px-6 pt-4">
                {[['details','📋 Details'],['form_fields','📝 Request Form'],['fulfillment','✅ Fulfillment']].map(([key,label])=>(
                  <button key={key} onClick={()=>setActiveTab(key)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab===key?'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400':'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {activeTab === 'details' && (
                  <>
                    {/* Icon picker */}
                    <div>
                      <label className={lbl}>Icon</label>
                      <div className="flex flex-wrap gap-2">
                        {ICONS.map(ic => (
                          <button key={ic} type="button" onClick={() => setForm(f=>({...f,icon:ic}))}
                                  className={`text-xl p-1.5 rounded-lg border transition ${form.icon===ic?'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30':'border-gray-200 dark:border-gray-600 hover:border-gray-400'}`}>
                            {ic}
                          </button>
                        ))}
                        <input value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))}
                               className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 text-sm w-16 text-center bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                               placeholder="emoji" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2"><label className={lbl}>Name *</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className={inp} placeholder="e.g. Laptop Request" /></div>
                      <div className="col-span-2"><label className={lbl}>Description</label><textarea rows={2} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} className={inp} /></div>
                      <div><label className={lbl}>Category *</label>
                        <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} required className={inp}>
                          <option value="">— Select Category —</option>
                          {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div><label className={lbl}>Visibility</label>
                        <select value={form.visibility} onChange={e=>setForm(f=>({...f,visibility:e.target.value}))} className={inp}>
                          {VISIBILITIES.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}
                        </select>
                      </div>
                      <div><label className={lbl}>Est. Cost ($)</label><input type="number" value={form.estimated_cost} onChange={e=>setForm(f=>({...f,estimated_cost:e.target.value}))} className={inp} /></div>
                      <div><label className={lbl}>Delivery (days)</label><input type="number" value={form.delivery_time_days} onChange={e=>setForm(f=>({...f,delivery_time_days:e.target.value}))} className={inp} /></div>
                      <div><label className={lbl}>SLA (hours)</label><input type="number" value={form.sla_hours} onChange={e=>setForm(f=>({...f,sla_hours:e.target.value}))} className={inp} placeholder="Optional override" /></div>
                      <div>
                        <label className={lbl}>Sort Order</label>
                        <input type="number" value={form.sort_order} onChange={e=>setForm(f=>({...f,sort_order:e.target.value}))} className={inp} placeholder="0" />
                        <p className="text-xs text-gray-400 mt-1">Lower numbers appear first in the catalog. Use 0 for normal items, negative to pin above everything else.</p>
                      </div>
                      <div><label className={lbl}>Priority</label>
                        <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} className={inp}>
                          {['low','medium','high','critical'].map(p=><option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div><label className={lbl}>Ticket Type</label>
                        <select value={form.ticket_type} onChange={e=>setForm(f=>({...f,ticket_type:e.target.value}))} className={inp}>
                          {['service_request','incident'].map(p=><option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-4 flex-wrap">
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.approval_required} onChange={e=>setForm(f=>({...f,approval_required:e.target.checked}))} className="rounded" /><span className="text-sm text-gray-700 dark:text-gray-300">Requires approval</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_featured} onChange={e=>setForm(f=>({...f,is_featured:e.target.checked}))} className="rounded" /><span className="text-sm text-gray-700 dark:text-gray-300">Quick Start featured</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_onboarding} onChange={e=>setForm(f=>({...f,is_onboarding:e.target.checked}))} className="rounded" /><span className="text-sm text-gray-700 dark:text-gray-300">Onboarding item</span></label>
                    </div>
                    <div><label className={lbl}>Pre-filled Ticket Title</label><input value={form.ticket_title} onChange={e=>setForm(f=>({...f,ticket_title:e.target.value}))} className={inp} /></div>
                    <div><label className={lbl}>Pre-filled Ticket Description</label><textarea rows={2} value={form.ticket_description} onChange={e=>setForm(f=>({...f,ticket_description:e.target.value}))} className={inp} /></div>
                    {form.is_onboarding && (
                      <div>
                        <div className="flex items-center justify-between mb-2"><label className={lbl}>Onboarding Tasks</label></div>
                        <div className="flex gap-2 mb-2">
                          <input value={newTask} onChange={e=>setNewTask(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&newTask.trim()){setForm(f=>({...f,onboarding_tasks:[...f.onboarding_tasks,{title:newTask,category:''}]}));setNewTask('');}}} placeholder="Task name..." className={inp+" flex-1"} />
                          <button onClick={()=>{if(newTask.trim()){setForm(f=>({...f,onboarding_tasks:[...f.onboarding_tasks,{title:newTask,category:''}]}));setNewTask('');}}} className="bg-indigo-600 text-white px-3 rounded-lg text-sm">Add</button>
                        </div>
                        {form.onboarding_tasks.map((task,i)=>(
                          <div key={i} className="flex items-center gap-2 mb-1">
                            <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">• {task.title||task}</span>
                            <button onClick={()=>setForm(f=>({...f,onboarding_tasks:f.onboarding_tasks.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {activeTab === 'form_fields' && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Add questions that requesters must answer when submitting this service.</p>
                    <div className="flex gap-2 mb-3">
                      <input value={newFormField.label} onChange={e=>setNewFormField(f=>({...f,label:e.target.value}))}
                             placeholder="Question label..." className={inp+" flex-1"} />
                      <select value={newFormField.type} onChange={e=>setNewFormField(f=>({...f,type:e.target.value}))} className={inp+" w-28"}>
                        <option value="text">Text</option>
                        <option value="textarea">Long text</option>
                        <option value="date">Date</option>
                      </select>
                      <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <input type="checkbox" checked={newFormField.required} onChange={e=>setNewFormField(f=>({...f,required:e.target.checked}))} /> Required
                      </label>
                      <button onClick={()=>{if(newFormField.label.trim()){setForm(f=>({...f,request_form_fields:[...f.request_form_fields,{...newFormField}]}));setNewFormField({label:'',type:'text',required:false});}}}
                              className="bg-indigo-600 text-white px-3 rounded-lg text-sm">Add</button>
                    </div>
                    {form.request_form_fields.length === 0 && <p className="text-xs text-gray-400 italic text-center py-4">No custom fields yet — requests go straight through</p>}
                    {form.request_form_fields.map((field,i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg mb-2">
                        <span className="text-sm flex-1 text-gray-800 dark:text-white">{field.label}</span>
                        <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded">{field.type}</span>
                        {field.required && <span className="text-xs text-red-500">Required</span>}
                        <button onClick={()=>setForm(f=>({...f,request_form_fields:f.request_form_fields.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'fulfillment' && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Checklist steps for agents to complete when fulfilling this request.</p>
                    <div className="flex gap-2 mb-3">
                      <input value={newChecklistItem} onChange={e=>setNewChecklistItem(e.target.value)}
                             onKeyDown={e=>{if(e.key==='Enter'&&newChecklistItem.trim()){setForm(f=>({...f,fulfillment_checklist:[...f.fulfillment_checklist,newChecklistItem.trim()]}));setNewChecklistItem('');}}}
                             placeholder="Checklist step..." className={inp+" flex-1"} />
                      <button onClick={()=>{if(newChecklistItem.trim()){setForm(f=>({...f,fulfillment_checklist:[...f.fulfillment_checklist,newChecklistItem.trim()]}));setNewChecklistItem('');}}}
                              className="bg-indigo-600 text-white px-3 rounded-lg text-sm">Add</button>
                    </div>
                    {form.fulfillment_checklist.length === 0 && <p className="text-xs text-gray-400 italic text-center py-4">No fulfillment steps yet</p>}
                    {form.fulfillment_checklist.map((step,i)=>(
                      <div key={i} className="flex items-center gap-2 p-2.5 bg-gray-50 dark:bg-gray-700 rounded-lg mb-2">
                        <span className="text-gray-400 text-xs font-mono w-5">{i+1}.</span>
                        <span className="text-sm flex-1 text-gray-800 dark:text-white">{step}</span>
                        <button onClick={()=>setForm(f=>({...f,fulfillment_checklist:f.fulfillment_checklist.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button onClick={handleSave} disabled={saving}
                        className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                  {saving ? 'Saving...' : (editingId ? 'Update Item' : 'Create Item')}
                </button>
                <button onClick={() => { setShowForm(false); setEditingId(null); }}
                        className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
