import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

// Variable placeholders shown as helper chips
const VARIABLES = [
  { label: '{{requester.name}}',  desc: "Requester's full name" },
  { label: '{{requester.email}}', desc: "Requester's email" },
  { label: '{{ticket.id}}',       desc: 'Ticket ID (e.g. INC000042)' },
  { label: '{{ticket.title}}',    desc: 'Ticket subject' },
  { label: '{{agent.name}}',      desc: "Agent's full name" },
  { label: '{{company.name}}',    desc: 'Your company name' },
];

const VISIBILITY_OPTS = [
  { value: 'all',      label: '👥 All agents', desc: 'Visible to everyone' },
  { value: 'personal', label: '👤 Personal',   desc: 'Only visible to you' },
  { value: 'group',    label: '🫂 Group',       desc: 'Visible to a specific agent group' },
];

export default function CannedResponses() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [responses, setResponses]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editing, setEditing]       = useState(null); // null | {} | existing
  const [form, setForm]             = useState({ title: '', content: '', category: '', visibility: 'all', group_id: '', sort_order: 0 });
  const [preview, setPreview]       = useState(null); // response being previewed
  const [showVariables, setShowVariables] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (search) params.append('search', search);
      if (categoryFilter) params.append('category', categoryFilter);
      const [data, cats] = await Promise.all([
        apiFetch(`/canned-responses/?${params}`, token),
        apiFetch('/canned-responses/categories', token),
      ]);
      setResponses(data.items ?? []);
      setCategories(Array.isArray(cats) ? cats : []);
    } catch(e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, [token]);
  useEffect(() => {
    const timer = setTimeout(fetchAll, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, categoryFilter]);

  const openNew  = () => { setForm({ title: '', content: '', category: '', visibility: 'all', group_id: '', sort_order: 0 }); setEditing({}); setPreview(null); };
  const openEdit = (r) => { setForm({ title: r.title, content: r.content, category: r.category||'', visibility: r.visibility||'all', group_id: r.group_id||'', sort_order: r.sort_order||0 }); setEditing(r); setPreview(null); };

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) { toast.error('Title and content are required'); return; }
    try {
      const payload = { ...form, group_id: form.group_id ? parseInt(form.group_id) : null };
      if (editing?.id) await apiFetch(`/canned-responses/${editing.id}`, token, { method: 'PUT', body: JSON.stringify(payload) });
      else await apiFetch('/canned-responses/', token, { method: 'POST', body: JSON.stringify(payload) });
      toast.success('Saved');
      setEditing(null);
      fetchAll();
    } catch(e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this canned response?')) return;
    try { await apiFetch(`/canned-responses/${id}`, token, { method: 'DELETE' }); fetchAll(); } catch(e) { toast.error(e.message); }
  };

  const insertVariable = (variable) => {
    setForm(f => ({ ...f, content: f.content + variable }));
  };

  const exportCSV = () => {
    const headers = ['ID','Title','Category','Visibility','Content','Use Count'];
    const rows = responses.map(r => [r.id, `"${r.title}"`, r.category||'', r.visibility, `"${r.content.replace(/"/g,'""')}"`, r.use_count||0]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'canned_responses.csv'; a.click();
  };

  // Group by category
  const grouped = responses.reduce((acc, r) => {
    const cat = r.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {});

  const inp  = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const lbl  = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">💬 {t('common.cannedResponses')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Pre-written reply templates. Use variables like {'{{requester.name}}'} for dynamic content.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition">
              📤 Export CSV
            </button>
            <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
              + New Response
            </button>
          </div>
        </div>

        {/* Edit/Create form */}
        {editing !== null && (
          <div className={card + " p-6 mb-6"}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">{editing.id ? 'Edit Response' : 'New Canned Response'}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>Title *</label><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className={inp} placeholder="e.g. Password Reset Instructions" /></div>
                <div><label className={lbl}>Category / Folder</label><input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} className={inp} placeholder="e.g. Account, Network, Hardware" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>Visibility</label>
                  <select value={form.visibility} onChange={e=>setForm({...form,visibility:e.target.value})} className={inp}>
                    {VISIBILITY_OPTS.map(v=><option key={v.value} value={v.value}>{v.label} — {v.desc}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>Sort Order</label><input type="number" value={form.sort_order} onChange={e=>setForm({...form,sort_order:parseInt(e.target.value)||0})} className={inp} /></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={lbl}>Content *</label>
                  <button onClick={() => setShowVariables(!showVariables)}
                          className="text-xs text-indigo-500 hover:text-indigo-700">
                    {showVariables ? 'Hide' : '+ Insert'} variables
                  </button>
                </div>
                {showVariables && (
                  <div className="mb-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mb-2">Click to insert at cursor position:</p>
                    <div className="flex flex-wrap gap-2">
                      {VARIABLES.map(v => (
                        <button key={v.label} onClick={() => insertVariable(v.label)}
                                title={v.desc}
                                className="text-xs font-mono bg-white dark:bg-gray-700 border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition">
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <textarea rows={6} value={form.content} onChange={e=>setForm({...form,content:e.target.value})}
                          className={inp} placeholder="Type your response... use {{requester.name}} for the requester's name, {{ticket.id}} for the ticket number, etc." />
              </div>
              {/* Live preview */}
              {form.content && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Preview (with sample data):</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {form.content
                      .replace(/\{\{requester\.name\}\}/g, 'John Smith')
                      .replace(/\{\{requester\.email\}\}/g, 'john@example.com')
                      .replace(/\{\{ticket\.id\}\}/g, 'INC000042')
                      .replace(/\{\{ticket\.title\}\}/g, 'Cannot access VPN')
                      .replace(/\{\{agent\.name\}\}/g, 'Support Agent')
                      .replace(/\{\{company\.name\}\}/g, 'DodoBay Ltd')
                    }
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">Save</button>
              <button onClick={() => { setEditing(null); setShowVariables(false); }} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">Cancel</button>
            </div>
          </div>
        )}

        {/* Search + category filter */}
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search responses..."
                   className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCategoryFilter('')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition ${!categoryFilter ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-400'}`}>
              All
            </button>
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(categoryFilter===cat ? '' : cat)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${categoryFilter===cat ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-400'}`}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Preview modal */}
        {preview && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPreview(null)}>
            <div className={card + " p-6 max-w-lg w-full"} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 dark:text-white">{preview.title}</h3>
                <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-3">
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{preview.content}</p>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Used {preview.use_count || 0} times · {preview.visibility}</span>
                <div className="flex gap-2">
                  <button onClick={() => { openEdit(preview); setPreview(null); }} className="text-indigo-500 hover:text-indigo-700">Edit</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Responses list grouped by category */}
        {loading ? (
          <p className="text-center text-gray-400 py-10">{t('common.loading')}</p>
        ) : responses.length === 0 ? (
          <div className={card + " p-12 text-center"}>
            <p className="text-4xl mb-3">💬</p>
            <p className="text-gray-500 dark:text-gray-400">No canned responses yet. Create one to speed up agent replies.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  📁 {category}
                  <span className="text-xs font-normal text-gray-400 normal-case">{items.length} responses</span>
                </h3>
                <div className="space-y-2">
                  {items.map(r => (
                    <div key={r.id} className={card + " px-5 py-4 flex items-start justify-between gap-4 hover:shadow-md transition cursor-pointer"}
                         onClick={() => setPreview(preview?.id === r.id ? null : r)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-gray-800 dark:text-white text-sm">{r.title}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${r.visibility==='personal' ? 'bg-gray-100 text-gray-500' : r.visibility==='group' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                            {r.visibility==='personal' ? '👤' : r.visibility==='group' ? '🫂' : '👥'} {r.visibility}
                          </span>
                          {r.use_count > 0 && <span className="text-xs text-gray-400">Used {r.use_count}×</span>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.content.replace(/\{\{[^}]+\}\}/g, m => m).substring(0, 100)}...</p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(r)} title="Edit"
                                className="text-indigo-500 hover:text-indigo-700 border border-indigo-200 dark:border-indigo-700 p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113 2.932L7.5 19.785 3 21l1.215-4.5L16.862 4.487z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(r.id)} title="Delete"
                                className="text-red-400 hover:text-red-600 border border-red-200 dark:border-red-800 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
