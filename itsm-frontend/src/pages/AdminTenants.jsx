import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const EMPTY_FORM = {
  name: '', slug: '', admin_email: '', admin_password: '',
  admin_name: '', support_email: '', company_tagline: '', primary_color: '#4f46e5',
};

export default function AdminTenants() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const fetchTenants = () => {
    apiFetch('/superadmin/tenants', token)
      .then(data => setTenants(Array.isArray(data) ? data : []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTenants(); }, [token]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/superadmin/tenants/${editingId}`, token, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name, support_email: form.support_email,
            company_tagline: form.company_tagline, primary_color: form.primary_color,
          }),
        });
        toast.success('Tenant updated successfully.');
      } else {
        await apiFetch('/superadmin/tenants', token, {
          method: 'POST', body: JSON.stringify(form),
        });
        toast.success(`Tenant "${form.name}" created successfully.`);
      }
      setShowForm(false); setEditingId(null); setForm(EMPTY_FORM);
      fetchTenants();
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const handleEdit = (tenant) => {
    setForm({
      ...EMPTY_FORM,
      name: tenant.name,
      support_email: tenant.support_email || '',
      company_tagline: tenant.company_tagline || '',
      primary_color: tenant.primary_color || '#4f46e5',
    });
    setEditingId(tenant.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleActive = async (tenant) => {
    try {
      await apiFetch(`/superadmin/tenants/${tenant.id}`, token, {
        method: 'PATCH', body: JSON.stringify({ is_active: !tenant.is_active }),
      });
      toast.success(`Tenant ${tenant.is_active ? 'deactivated' : 'activated'}.`);
      fetchTenants();
    } catch (err) { toast.error(err.message); }
  };

  const autoSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const labelClass = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Tenant Management</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage client organisations on DodoDesk.</p>
          </div>
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }} className={btnPrimary}>
            New Tenant
          </button>
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div className={`${cardClass} mb-6`}>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
              {editingId ? 'Edit Tenant' : 'New Tenant'}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Company Name *</label>
                  <input type="text" required value={form.name}
                         onChange={e => setForm({ ...form, name: e.target.value, slug: editingId ? form.slug : autoSlug(e.target.value) })}
                         placeholder="e.g. Acme Corp" className={inputClass} />
                </div>
                {!editingId && (
                  <div>
                    <label className={labelClass}>Slug * (unique identifier)</label>
                    <input type="text" required value={form.slug}
                           onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                           placeholder="e.g. acme-corp" className={inputClass} />
                    <p className="text-xs text-gray-400 mt-1">Used in URLs — lowercase, hyphens only</p>
                  </div>
                )}
                <div>
                  <label className={labelClass}>Support Email</label>
                  <input type="email" value={form.support_email}
                         onChange={e => setForm({ ...form, support_email: e.target.value })}
                         placeholder="support@client.com" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Company Tagline</label>
                  <input type="text" value={form.company_tagline}
                         onChange={e => setForm({ ...form, company_tagline: e.target.value })}
                         placeholder="e.g. Powering better IT" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Brand Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={form.primary_color}
                           onChange={e => setForm({ ...form, primary_color: e.target.value })}
                           className="w-10 h-10 rounded cursor-pointer border border-gray-300" />
                    <input type="text" value={form.primary_color}
                           onChange={e => setForm({ ...form, primary_color: e.target.value })}
                           className={`${inputClass} flex-1`} placeholder="#4f46e5" />
                  </div>
                </div>
              </div>

              {!editingId && (
                <>
                  <hr className="border-gray-200 dark:border-gray-700" />
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Admin User for this Tenant</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Admin Full Name</label>
                      <input type="text" value={form.admin_name}
                             onChange={e => setForm({ ...form, admin_name: e.target.value })}
                             placeholder="e.g. John Smith" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Admin Email</label>
                      <input type="email" value={form.admin_email}
                             onChange={e => setForm({ ...form, admin_email: e.target.value })}
                             placeholder="admin@client.com" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Admin Password</label>
                      <input type="password" value={form.admin_password}
                             onChange={e => setForm({ ...form, admin_password: e.target.value })}
                             placeholder="Min 8 characters" className={inputClass} />
                    </div>
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className={btnPrimary}>
                  {saving ? 'Saving...' : editingId ? 'Update Tenant' : 'Create Tenant'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }} className={btnSecondary}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tenant list */}
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : tenants.length === 0 ? (
          <div className={`${cardClass} text-center py-12`}>
            <p className="text-4xl mb-3">🏢</p>
            <p className="text-gray-500 dark:text-gray-400">No tenants yet. Create your first client tenant.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tenants.map(tenant => (
              <div key={tenant.id} className={`${cardClass} flex items-center justify-between`}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: tenant.primary_color }} />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800 dark:text-white">{tenant.name}</p>
                      <span className="text-xs text-gray-400 dark:text-gray-500 font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                        {tenant.slug}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tenant.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                        {tenant.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {tenant.user_count} users · {tenant.ticket_count} tickets
                      {tenant.support_email && ` · ${tenant.support_email}`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(tenant)}
                          className="text-sm text-indigo-500 hover:underline">Edit</button>
                  <button onClick={() => handleToggleActive(tenant)}
                          className={`text-sm hover:underline ${tenant.is_active ? 'text-red-500' : 'text-green-500'}`}>
                    {tenant.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
