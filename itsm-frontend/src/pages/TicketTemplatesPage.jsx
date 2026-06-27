import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const TICKET_TYPES = ['incident','service_request','change'];
const PRIORITIES   = ['low','medium','high','critical'];
const CATEGORIES   = ['Hardware','Software','Network','Account','Email','Security','Printer','Mobile Device','Cloud Services','Telephony','Other'];

export default function TicketTemplatesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ name:'', ticket_type:'incident', title:'', description:'', category:'', priority:'medium', tags:[] });

  const fetch_all = async () => {
    try { setTemplates(await apiFetch('/ticket-templates/', token)); } catch(e) { toast.error(e.message); }
  };
  useEffect(() => { fetch_all(); }, [token]);

  const openNew  = () => { setForm({ name:'', ticket_type:'incident', title:'', description:'', category:'', priority:'medium', tags:[] }); setEditing({}); };
  const openEdit = (t) => { setForm({ name:t.name, ticket_type:t.ticket_type, title:t.title||'', description:t.description||'', category:t.category||'', priority:t.priority||'medium', tags:t.tags||[] }); setEditing(t); };

  const handleSave = async () => {
    try {
      if (editing?.id) await apiFetch(`/ticket-templates/${editing.id}`, token, { method:'PUT', body:JSON.stringify(form) });
      else await apiFetch('/ticket-templates/', token, { method:'POST', body:JSON.stringify(form) });
      toast.success('Template saved');
      setEditing(null);
      fetch_all();
    } catch(e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this template?')) return;
    try { await apiFetch(`/ticket-templates/${id}`, token, { method:'DELETE' }); fetch_all(); } catch(e) { toast.error(e.message); }
  };

  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const inp  = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const lbl  = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">📋 Ticket Templates</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Pre-filled ticket forms for common request types</p>
          </div>
          <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">+ New Template</button>
        </div>

        {editing !== null ? (
          <div className={card}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">{editing.id ? 'Edit Template' : 'New Template'}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>Template Name *</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className={inp} placeholder="e.g. VPN Access Request" /></div>
                <div><label className={lbl}>Ticket Type</label>
                  <select value={form.ticket_type} onChange={e=>setForm({...form,ticket_type:e.target.value})} className={inp}>
                    {TICKET_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={lbl}>Pre-filled Title</label><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className={inp} placeholder="Auto-fills the ticket title" /></div>
              <div><label className={lbl}>Pre-filled Description</label><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={3} className={inp} placeholder="Auto-fills the ticket description" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>Category</label>
                  <select value={form.category} onChange={e=>setForm({...form,category:e.target.value})} className={inp}>
                    <option value="">Select category</option>
                    {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>Priority</label>
                  <select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})} className={inp}>
                    {PRIORITIES.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">Save Template</button>
              <button onClick={() => setEditing(null)} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.length === 0 && (
              <div className={card + " text-center py-10"}>
                <p className="text-gray-400 text-sm">No templates yet. Create one to speed up ticket creation.</p>
              </div>
            )}
            {templates.map(t => (
              <div key={t.id} className={card + " flex items-start justify-between"}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-800 dark:text-white">📋 {t.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${t.ticket_type==='incident'?'bg-red-100 text-red-700':t.ticket_type==='service_request'?'bg-blue-100 text-blue-700':'bg-purple-100 text-purple-700'}`}>{t.ticket_type}</span>
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">{t.priority}</span>
                  </div>
                  {t.title && <p className="text-xs text-gray-600 dark:text-gray-300">Title: "{t.title}"</p>}
                  {t.category && <p className="text-xs text-gray-400">Category: {t.category}</p>}
                </div>
                <div className="flex gap-2 ml-4">
                  <button onClick={() => openEdit(t)} className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 dark:border-indigo-700 px-3 py-1 rounded-lg">Edit</button>
                  <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 dark:border-red-800 px-3 py-1 rounded-lg">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
