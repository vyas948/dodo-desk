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

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({ skip: 0, limit: 1000 });
      const data = await apiFetch(`/admin/users?${params}`, token);
      const allUsers = data.items ?? [];
      if (allUsers.length === 0) { toast.error('No users found.'); return; }
      const headers = ['User ID', 'Full Name', 'Email', 'Tenant', 'Role', 'Job Title', 'Department', 'Active', 'Status Last Changed', 'Created At'];
      const rows = allUsers.map(u => [
        `USR${String(u.id).padStart(5, '0')}`,
        u.full_name || '', u.email || '',
        u.tenant_name || '—',
        u.role || '',
        u.job_title || '', u.department || '',
        u.is_active ? 'Yes' : 'No',
        u.status_changed_at ? new Date(u.status_changed_at).toLocaleString() : '—',
        u.created_at ? new Date(u.created_at).toLocaleDateString() : '',
      ]);
      const csv = [headers, ...rows]
        .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dodesk-users-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${allUsers.length} users.`);
    } catch (err) { toast.error('Export failed: ' + (err?.message || 'Unknown error')); }
  };

  const unlockUser = async (userId, userName) => {
    try {
      await apiFetch(`/admin/users/${userId}/unlock`, token, { method: 'POST' });
      toast.success(`${userName} has been unlocked.`);
      fetchUsers(page);
    } catch (err) { toast.error(err.message); }
  };

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
          <div className="flex gap-2">
            <button onClick={() => navigate('/admin/users/new')} className={btnPrimary}>{t('admin.addUser')}</button>
            <button onClick={handleExport}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 transition">
              Export CSV
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">User ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.fullName')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.email')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tenant</th>
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
                        <td className="px-6 py-4 text-xs font-mono text-gray-400 dark:text-gray-500">USR{String(user.id).padStart(5, '0')}</td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                          <div className="flex items-center gap-2">
                            {user.full_name}
                            {user.is_locked && (
                              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                                🔒 Locked
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{user.email}</td>
                        <td className="px-6 py-4 text-sm">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 font-medium">
                            {user.tenant_name || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 italic">{user.job_title || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{t(`common.${user.role}`)}</td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex gap-3 items-center">
                            <button onClick={() => navigate(`/admin/users/${user.id}/edit`)}
                                    title="Edit user"
                                    className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition">
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113 2.932L7.5 19.785 3 21l1.215-4.5L16.862 4.487z" />
                              </svg>
                            </button>
                            {user.is_locked && (
                              <button onClick={() => unlockUser(user.id, user.full_name)}
                                      title="Unlock account"
                                      className="text-yellow-500 hover:text-yellow-700 transition">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                </svg>
                              </button>
                            )}
                            <button onClick={() => toggleActive(user.id, user.is_active)}
                                    title={user.is_active ? 'Disable user' : 'Enable user'}
                                    className={`transition ${user.is_active ? 'text-red-400 hover:text-red-600' : 'text-green-500 hover:text-green-700'}`}>
                              {user.is_active ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              )}
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
