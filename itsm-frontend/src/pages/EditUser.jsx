import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const DEPARTMENTS = ['Management','HR','IT','Finance','Operations','Sales & Marketing','Legal','Other Department'];

export default function EditUser() {
  const { id } = useParams();
  const { token } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '', email: '', role: 'employee', job_title: '', department: '', is_active: true, tenant_id: '',
  });
  const [tenants, setTenants] = useState([]);
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/superadmin/tenants', token)
      .then(data => setTenants(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    apiFetch(`/admin/users/${id}`, token)
      .then(data => setForm({
        full_name: data.full_name || '',
        email: data.email || '',
        role: data.role || 'employee',
        job_title: data.job_title || '',
        department: data.department || '',
        is_active: data.is_active,
        tenant_id: data.tenant_id || '',
      }))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [id, token]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.tenant_id) payload.tenant_id = parseInt(payload.tenant_id);
      if (newPassword) payload.password = newPassword;
      await apiFetch(`/admin/users/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast.success('User updated successfully.');
      navigate('/admin/users');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";

  if (loading) return <Layout><div className="p-10 text-center text-gray-400">Loading...</div></Layout>;

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/admin/users')}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
            ← Back
          </button>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Edit User</h2>
        </div>

        <div className={cardClass}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className={labelClass}>Full Name *</label>
              <input type="text" required value={form.full_name}
                     onChange={e => setForm({...form, full_name: e.target.value})}
                     className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Email *</label>
              <input type="email" required value={form.email}
                     onChange={e => setForm({...form, email: e.target.value})}
                     className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Role</label>
              <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className={inputClass}>
                <option value="employee">Employee</option>
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Tenant</label>
              <select value={form.tenant_id} onChange={e => setForm({...form, tenant_id: e.target.value})} className={inputClass}>
                <option value="">— Select Tenant —</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Job Title</label>
              <input type="text" value={form.job_title}
                     onChange={e => setForm({...form, job_title: e.target.value})}
                     placeholder="e.g. IT Manager" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Department</label>
              <select value={form.department} onChange={e => setForm({...form, department: e.target.value})} className={inputClass}>
                <option value="">— Select Department —</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>New Password</label>
              <input type="password" value={newPassword}
                     onChange={e => setNewPassword(e.target.value)}
                     placeholder="Leave blank to keep current" className={inputClass} />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="is_active" checked={form.is_active}
                     onChange={e => setForm({...form, is_active: e.target.checked})}
                     className="w-4 h-4 rounded text-indigo-600" />
              <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">Account Active</label>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving}
                      className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" onClick={() => navigate('/admin/users')}
                      className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-500 transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
