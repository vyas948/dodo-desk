import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const DEPARTMENTS = ['Management','HR','IT','Finance','Operations','Sales & Marketing','Legal','Other Department'];

export default function CreateUser() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);

  useEffect(() => {
    apiFetch('/superadmin/tenants', token)
      .then(data => setTenants(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token]);

  const [form, setForm] = useState({
    full_name: '', email: '', password: '', role: 'employee',
    job_title: '', department: '', employee_id: '', tenant_id: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/admin/users', token, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast.success('User created successfully.');
      navigate('/admin/users');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/admin/users')}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
            ← Back
          </button>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color:'var(--text-primary)'}}>
            {t('admin.createUser')}
          </h2>
        </div>

        <div className={cardClass}>
          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label className={labelClass}>{t('admin.fullName')} <span className="text-red-500">*</span></label>
              <input type="text" value={form.full_name} required
                     onChange={e => setForm({...form, full_name: e.target.value})}
                     placeholder="e.g. John Smith" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('admin.email')} <span className="text-red-500">*</span></label>
              <input type="email" value={form.email} required
                     onChange={e => setForm({...form, email: e.target.value})}
                     placeholder="john@company.com" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('admin.password')} <span className="text-red-500">*</span></label>
              <input type="password" value={form.password} required
                     onChange={e => setForm({...form, password: e.target.value})}
                     placeholder="Min 8 characters" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('admin.role')}</label>
              <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className={inputClass}>
                <option value="employee">{t('common.employee')}</option>
                <option value="agent">{t('common.agent')}</option>
                <option value="admin">{t('common.admin')}</option>
                {user?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
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
              <label className={labelClass}>Employee ID <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="text" value={form.employee_id}
                     onChange={e => setForm({...form, employee_id: e.target.value})}
                     placeholder="e.g. EMP-001, HR-042" className={inputClass} />
              <p className="text-xs text-gray-400 mt-1">Custom employee reference number — not system generated</p>
            </div>
            <div>
              <label className={labelClass}>Job Title</label>
              <input type="text" value={form.job_title}
                     onChange={e => setForm({...form, job_title: e.target.value})}
                     placeholder="e.g. IT Manager, HR Officer" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Department</label>
              <select value={form.department} onChange={e => setForm({...form, department: e.target.value})} className={inputClass}>
                <option value="">— Select Department —</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving}
                      className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                {saving ? 'Creating...' : t('admin.createUser')}
              </button>
              <button type="button" onClick={() => navigate('/admin/users')}
                      className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-500 transition">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
