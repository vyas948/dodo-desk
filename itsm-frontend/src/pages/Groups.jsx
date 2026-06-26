import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

export default function Groups() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [groups, setGroups] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', member_ids: [] });

  const isAdmin = ['admin', 'super_admin'].includes(user?.role);

  const fetchGroups = () => {
    apiFetch('/groups/', token)
      .then(data => setGroups(Array.isArray(data) ? data : []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    fetchGroups();
    // Load agents for member picker
    apiFetch('/admin/users?role=agent&limit=200', token)
      .then(data => setAgents(data.items ?? []))
      .catch(() => {});
  }, [token]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Group name is required'); return; }
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/groups/${editingId}`, token, { method: 'PATCH', body: JSON.stringify(form) });
        toast.success('Group updated');
      } else {
        await apiFetch('/groups/', token, { method: 'POST', body: JSON.stringify(form) });
        toast.success('Group created');
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ name: '', description: '', member_ids: [] });
      fetchGroups();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (g) => {
    setForm({ name: g.name, description: g.description || '', member_ids: g.members.map(m => m.id) });
    setEditingId(g.id);
    setShowForm(true);
  };

  const handleDelete = async (g) => {
    if (!window.confirm(`Delete group "${g.name}"? Tickets in this group will be unassigned.`)) return;
    try {
      await apiFetch(`/groups/${g.id}`, token, { method: 'DELETE' });
      toast.success('Group deleted');
      fetchGroups();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleMember = (uid) => {
    setForm(f => ({
      ...f,
      member_ids: f.member_ids.includes(uid)
        ? f.member_ids.filter(id => id !== uid)
        : [...f.member_ids, uid]
    }));
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Agent Groups</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Organise agents into groups and assign tickets to groups</p>
          </div>
          {isAdmin && (
            <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', description: '', member_ids: [] }); }}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
              + New Group
            </button>
          )}
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div className={`${cardClass} mb-6 border-indigo-200 dark:border-indigo-700`}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">{editingId ? 'Edit Group' : 'New Group'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Group Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                       placeholder="e.g. Network Team, Desktop Support"
                       className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                       placeholder="What does this group handle?"
                       className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Members</label>
                {agents.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No agents found</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
                    {agents.map(a => (
                      <label key={a.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                        <input type="checkbox" checked={form.member_ids.includes(a.id)} onChange={() => toggleMember(a.id)}
                               className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                        <div>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{a.full_name}</p>
                          <p className="text-xs text-gray-400">{a.email}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">{form.member_ids.length} member{form.member_ids.length !== 1 ? 's' : ''} selected</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleSave} disabled={saving}
                        className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                  {saving ? 'Saving...' : editingId ? 'Update Group' : 'Create Group'}
                </button>
                <button onClick={() => { setShowForm(false); setEditingId(null); }}
                        className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-5 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Groups List */}
        {loading ? (
          <div className={`${cardClass} text-center py-10`}>
            <p className="text-gray-400">{t('common.loading')}</p>
          </div>
        ) : groups.length === 0 ? (
          <div className={`${cardClass} text-center py-12`}>
            <p className="text-4xl mb-3">👥</p>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No groups yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Create a group to organise your agents and assign tickets to teams</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(g => (
              <div key={g.id} className={cardClass}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded">
                        GRP-{String(g.id).padStart(3, '0')}
                      </span>
                      <h3 className="font-semibold text-gray-800 dark:text-white">{g.name}</h3>
                    </div>
                    {g.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{g.description}</p>}
                    <div className="flex flex-wrap gap-2">
                      {g.members.map(m => (
                        <span key={m.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800">
                          <span className="w-4 h-4 rounded-full bg-blue-200 dark:bg-blue-700 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold" style={{fontSize:'8px'}}>
                            {m.full_name.charAt(0)}
                          </span>
                          {m.full_name}
                        </span>
                      ))}
                      {g.members.length === 0 && <span className="text-xs text-gray-400 italic">No members yet</span>}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-3 ml-4">
                      <button onClick={() => handleEdit(g)}
                              className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition text-sm">Edit</button>
                      <button onClick={() => handleDelete(g)}
                              className="text-red-400 hover:text-red-600 dark:hover:text-red-400 transition text-sm">Delete</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
