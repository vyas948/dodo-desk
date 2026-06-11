import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import { API } from '../api';

const LIMIT = 20; // v2

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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.role')}</th>
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
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{t(`common.${user.role}`)}</td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex gap-3 items-center">
                            <button onClick={() => navigate(`/admin/users/${user.id}/edit`)}
                                    title="Edit user"
                                    className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition">
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z" />
                              </svg>
                            </button>
                            <button onClick={() => toggleActive(user.id, user.is_active)}
                                    title={user.is_active ? 'Disable user' : 'Enable user'}
                                    className={`transition ${user.is_active ? 'text-red-400 hover:text-red-600' : 'text-green-500 hover:text-green-700'}`}>
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
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
