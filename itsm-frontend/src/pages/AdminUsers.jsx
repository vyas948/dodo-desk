import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import { API } from '../api';

const LIMIT = 20;

const DEPARTMENTS = ['Management','HR','IT','Finance','Operations','Sales & Marketing','Legal','Other Department'];

export default function AdminUsers() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchUsers = (p = 1) => {
    const params = new URLSearchParams({ skip: (p - 1) * LIMIT, limit: LIMIT });
    fetch(`${API}/admin/users?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setUsers(data.items ?? []); setTotal(data.total ?? 0); })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(1); }, [token]);

  const handlePageChange = (p) => { setPage(p); fetchUsers(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const toggleActive = async (userId, currentActive) => {
    await fetch(`${API}/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    fetchUsers(page);
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const selectClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('admin.userManagement')}</h2>
          <button onClick={() => navigate('/admin/users/new')} className={btnPrimary}>{t('admin.addUser')}</button>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.fullName')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.email')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Job Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Department</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.role')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.status')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {['admin', 'agent', 'employee'].map(role => {
                  const group = users.filter(u => u.role === role);
                  if (!group.length) return null;
                  return [
                    <tr key={`header-${role}`} className="bg-gray-50 dark:bg-gray-700/50">
                      <td colSpan={7} className="px-6 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {role === 'admin' ? '🔑 Admins' : role === 'agent' ? '🎧 Agents' : '👤 Employees'} ({group.length})
                      </td>
                    </tr>,
                    ...group.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 text-sm font-medium text-gray-700 dark:text-gray-300">{user.full_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{user.email}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 italic">{user.job_title || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{user.department || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{t(`common.${user.role}`)}</td>
                        <td className="px-6 py-4 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                            {user.is_active ? t('admin.active') : t('admin.disabled')}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex gap-2">
                            <button onClick={() => navigate(`/admin/users/${user.id}/edit`)}
                                    className="px-3 py-1 rounded-lg text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800">
                              Edit
                            </button>
                            <button onClick={() => toggleActive(user.id, user.is_active)}
                                    className={`px-3 py-1 rounded-lg text-xs font-medium ${user.is_active ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800' : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'}`}>
                              {user.is_active ? t('admin.disable') : t('admin.enable')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ];
                })}
              </tbody>
            </table></div>
            <div className="border-t border-gray-100 dark:border-gray-700 px-6">
              <Pagination total={total} page={page} limit={LIMIT} onPageChange={handlePageChange} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
