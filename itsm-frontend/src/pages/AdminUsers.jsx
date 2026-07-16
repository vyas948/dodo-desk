import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import ExportMenu from '../components/ExportMenu';
import { useBranding } from '../contexts/BrandingContext';
import { API } from '../api';

const LIMIT = 20; // v2

const DEPARTMENTS = ['Management','HR','IT','Finance','Operations','Sales & Marketing','Legal','Other Department'];

export default function AdminUsers() {
  const { token, user: currentUser } = useAuth();
  const branding = useBranding();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const [tenantOptions, setTenantOptions] = useState([]);
  const [filesModal, setFilesModal] = useState(null);   // { userId, userName, files, loading }
  const [tenants, setTenants] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterTenant, setFilterTenant] = useState('');

  // Single useEffect — live search + filters
  useEffect(() => {
    if (!token) return;
    const delay = searchTerm ? 300 : 0;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ skip: (page - 1) * LIMIT, limit: LIMIT });
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      if (filterRole) params.append('role', filterRole);
      if (filterTenant) params.append('tenant_id', filterTenant);
      apiFetch(`/admin/users?${params}`, token)
        .then(data => { setUsers(data.items ?? []); setTotal(data.total ?? 0); })
        .catch(err => toast.error(err.message))
        .finally(() => setLoading(false));
    }, delay);
    return () => clearTimeout(timer);
  }, [token, searchTerm, filterRole, filterTenant, page]);

  useEffect(() => {
    if (['super_admin','platform_admin'].includes(currentUser?.role)) {
      apiFetch('/superadmin/tenants', token)
        .then(data => {
          const list = Array.isArray(data) ? data : [];
          setTenantOptions(list.map(t => t.name));
          setTenants(list);
        })
        .catch(() => {});
    }
  }, [token, currentUser]);

  const handlePageChange = (p) => { setPage(p); };
  const handleSearch = (e) => { setSearchTerm(e.target.value); setPage(1); };

  // Component-level — used in both JSX and export function
  const includeTenantCol = ['super_admin','platform_admin'].includes(currentUser?.role);

  const getUserExportData = async () => {
    const params = new URLSearchParams({ skip: 0, limit: 1000 });
    const data = await apiFetch(`/admin/users?${params}`, token);
    const allUsers = data.items ?? [];
    const headers = ['User ID', 'Full Name', 'Email', 'Tenant', 'Role', 'Job Title', 'Department', 'Active', 'Status Last Changed', 'Created At'];
    const rows = allUsers.map(u => [
      `USR${String(u.id).padStart(5, '0')}`,
      u.full_name || '', u.email || '',
      u.tenant_name || 'N/A',
      u.role || '',
      u.job_title || '', u.department || '',
      u.is_active ? 'Yes' : 'No',
      u.status_changed_at ? new Date(u.status_changed_at).toLocaleString() : 'Never changed',
      u.created_at ? new Date(u.created_at).toLocaleDateString() : '',
    ]);
    return { headers, rows };
  };


  const handleDownloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Users');

    const columns = [
      { header: 'full_name', key: 'full_name', width: 22 },
      { header: 'email', key: 'email', width: 28 },
      { header: 'role', key: 'role', width: 14 },
      { header: 'job_title', key: 'job_title', width: 22 },
      { header: 'department', key: 'department', width: 22 },
      { header: 'employee_id', key: 'employee_id', width: 18 },
      { header: 'password', key: 'password', width: 18 },
      ...(includeTenantCol ? [{ header: 'tenant', key: 'tenant', width: 24 }] : []),
    ];
    sheet.columns = columns;

    // Sample row
    sheet.addRow({
      full_name: 'Jane Doe',
      email: 'jane.doe@example.com',
      role: 'employee',
      job_title: 'HR Manager',
      department: 'HR',
      password: '',
      ...(includeTenantCol ? { tenant: tenantOptions[0] || '' } : {}),
    });

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };

    // Data validation dropdowns for rows 2-200
    const roleColLetter = String.fromCharCode(65 + columns.findIndex(c => c.key === 'role'));
    const deptColLetter = String.fromCharCode(65 + columns.findIndex(c => c.key === 'department'));
    const roleOptions = ['readonly', 'employee', 'agent', 'admin'];

    for (let r = 2; r <= 200; r++) {
      sheet.getCell(`${roleColLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${roleOptions.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Invalid role',
        error: 'Please select a value from the dropdown list.',
      };
      sheet.getCell(`${deptColLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${DEPARTMENTS.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Invalid department',
        error: 'Please select a value from the dropdown list.',
      };
      if (includeTenantCol && tenantOptions.length > 0) {
        const tenantColLetter = String.fromCharCode(65 + columns.findIndex(c => c.key === 'tenant'));
        sheet.getCell(`${tenantColLetter}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${tenantOptions.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'Invalid tenant',
          error: 'Please select a value from the dropdown list.',
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dodesk-user-import-template.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!importFile) { toast.error('Please choose a CSV file.'); return; }
    setImporting(true);
    setImportResults(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await fetch(`${API}/admin/users/bulk-import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Import failed (${res.status})`);
      }
      const data = await res.json();
      setImportResults(data);
      if (data.created.length > 0) {
        toast.success(`Imported ${data.created.length} user(s) successfully.`);
        fetchUsers(1);
      }
      if (data.skipped.length > 0 || data.errors.length > 0) {
        toast.error(`${data.skipped.length} skipped, ${data.errors.length} error(s). See details below.`);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  const unlockUser = async (userId, userName) => {
    try {
      await apiFetch(`/admin/users/${userId}/unlock`, token, { method: 'POST' });
      toast.success(`${userName} has been unlocked.`);
      // Optimistically update the local list — no refetch needed
      setUsers(prev => prev.map(u =>
        u.id === userId ? { ...u, is_locked: false, locked_until: null, failed_login_attempts: 0, is_active: true } : u
      ));
    } catch (err) { toast.error(err.message); }
  };

  const viewUserFiles = async (userId, userName) => {
    setFilesModal({ userId, userName, files: [], loading: true });
    try {
      const data = await apiFetch(`/superadmin/users/${userId}/files`, token);
      setFilesModal({ userId, userName, files: data.files || [], loading: false,
                      cloudinaryPath: data.cloudinary_avatar_path, total: data.total_files });
    } catch (err) {
      toast.error(`Could not load files: ${err.message}`);
      setFilesModal(null);
    }
  };

  const deleteUser = async (userId, userName, email) => {
    if (!window.confirm(`⚠️ Permanently delete ${userName} (${email})?\n\nThis cannot be undone.`)) return;
    try {
      await apiFetch(`/admin/users/${userId}`, token, { method: 'DELETE' });
      toast.success(`${userName} has been deleted.`);
      // Remove from local list immediately
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (err) { toast.error(err.message); }
  };

  const toggleActive = async (userId, currentActive) => {
    try {
      await apiFetch(`/admin/users/${userId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !currentActive }),
      });
      const msg = currentActive ? 'User disabled.' : 'User enabled.';
      toast.success(msg);
      // Optimistically update local list
      setUsers(prev => prev.map(u =>
        u.id === userId ? { ...u, is_active: !currentActive } : u
      ));
    } catch (err) { toast.error(err.message); }
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('admin.userManagement')}</h2>
          <div className="flex gap-2">
            <button onClick={() => navigate('/admin/users/new')} className={btnPrimary}>{t('admin.addUser')}</button>
            <button onClick={() => { setShowImport(true); setImportResults(null); setImportFile(null); }}
                    className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 transition">
              {t('admin.bulkImport') || 'Import Users'}
            </button>
            <ExportMenu
              getData={getUserExportData}
              filename={`dodesk-users-${new Date().toISOString().slice(0, 10)}`}
              title="User List"
              branding={branding}
              label={t('common.export') || 'Export'}
            />
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          {/* Live search */}
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearch}
              placeholder="Search by name, email, ID, employee ID..."
              className="w-full pl-9 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {searchTerm && (
              <button onClick={() => { setSearchTerm(''); setPage(1); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">✕</button>
            )}
          </div>
          {/* Role filter */}
          <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Roles</option>
            <option value="readonly">👁️ Read-Only</option>
            <option value="employee">Employee</option>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
            {['super_admin','platform_admin'].includes(currentUser?.role) && <option value="super_admin">Super Admin</option>}
          </select>
          {/* Tenant filter (super admin only) */}
          {['super_admin','platform_admin'].includes(currentUser?.role) && tenants.length > 0 && (
            <select value={filterTenant} onChange={e => { setFilterTenant(e.target.value); setPage(1); }}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">All Tenants</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {/* Clear filters */}
          {(searchTerm || filterRole || filterTenant) && (
            <button onClick={() => { setSearchTerm(''); setFilterRole(''); setFilterTenant(''); setPage(1); }}
                    className="text-sm text-indigo-500 hover:underline px-2">
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-gray-400 dark:text-gray-500">{t('common.loading')}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {/* Results count */}
            <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {total === 0 ? 'No users found' : `Showing ${((page-1)*LIMIT)+1}–${Math.min(page*LIMIT, total)} of ${total} users`}
              </p>
              {(searchTerm || filterRole || filterTenant) && (
                <span className="text-xs text-indigo-500">Filtered</span>
              )}
            </div>
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">User ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.fullName')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.email')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Emp. ID</th>
                  {includeTenantCol && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tenant</th>}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Job Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('admin.role')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                      {searchTerm || filterRole || filterTenant ? 'No users match your filters.' : 'No users found.'}
                    </td>
                  </tr>
                ) : users.map(user => (
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
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 font-mono">
                          {user.employee_id || <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        {includeTenantCol && (
                          <td className="px-6 py-4 text-sm">
                            <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 font-medium">
                              {user.tenant_name || '—'}
                            </span>
                          </td>
                        )}
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 italic">{user.job_title || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            ['super_admin','platform_admin'].includes(user?.role) ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' :
                            user?.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' :
                            user?.role === 'agent' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' :
                            user?.role === 'readonly' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' :
                            'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                          }`}>
                            {['super_admin','platform_admin'].includes(user?.role) ? '👑' : user?.role === 'admin' ? '🔑' : user?.role === 'agent' ? '🎧' : user?.role === 'readonly' ? '👁️' : '👤'} {t(`common.${user?.role}`)}
                          </span>
                        </td>
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
                            {['super_admin','platform_admin'].includes(currentUser?.role) && (
                              <>
                                <button onClick={() => viewUserFiles(user.id, user.full_name)}
                                        title="View user files (GDPR/Support use only)"
                                        className="text-indigo-400 hover:text-indigo-600 transition">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                                  </svg>
                                </button>
                                <button onClick={() => deleteUser(user.id, user.full_name, user.email)}
                                        title="Delete user permanently"
                                        className="text-red-400 hover:text-red-600 transition">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                ))}
              </tbody>
            </table></div>
            <div className="border-t border-gray-100 dark:border-gray-700 px-6">
              <Pagination total={total} page={page} limit={LIMIT} onPageChange={handlePageChange} />
            </div>
          </div>
        )}

        {/* Bulk Import Modal */}
        {showImport && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">{t('admin.bulkImport') || 'Import Users'}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t('admin.importDescription') || 'Upload a CSV or Excel (.xlsx) file to create multiple users at once.'} {t('admin.importRequired') || 'Required columns:'} <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">full_name</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">email</code>.
                {t('admin.importOptional') || 'Optional:'} <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">role</code> (readonly/employee/agent/admin), <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">employee_id</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">job_title</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">department</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">password</code>{['super_admin','platform_admin'].includes(currentUser?.role) && <>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">tenant</code></>}.
                {t('admin.importPasswordNote') || 'If password is left blank, a random temporary password is generated.'}
              </p>

              <button onClick={handleDownloadTemplate} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4">
                ⬇ {t('admin.downloadTemplate') || 'Download Excel template (with dropdowns)'}
              </button>

              <input type="file" accept=".csv,.xlsx,.xlsm" onChange={e => setImportFile(e.target.files?.[0] || null)}
                     className="block w-full text-sm text-gray-600 dark:text-gray-300 mb-4
                                 border border-gray-300 dark:border-gray-600 rounded-lg
                                 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0
                                 file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-900 dark:file:text-indigo-300
                                 file:cursor-pointer cursor-pointer" />

              {importResults && (
                <div className="mb-4 space-y-3 text-sm">
                  {importResults.created.length > 0 && (
                    <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-3">
                      <p className="font-medium text-green-700 dark:text-green-300 mb-1">✅ Created ({importResults.created.length})</p>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {importResults.created.map((u, idx) => (
                          <p key={idx} className="text-xs text-gray-600 dark:text-gray-400">
                            {u.full_name} ({u.email}){u.temp_password && <> — temp password: <code className="bg-white dark:bg-gray-800 px-1 rounded">{u.temp_password}</code></>}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {importResults.skipped.length > 0 && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3">
                      <p className="font-medium text-yellow-700 dark:text-yellow-300 mb-1">⚠ Skipped ({importResults.skipped.length})</p>
                      <div className="max-h-24 overflow-y-auto space-y-1">
                        {importResults.skipped.map((u, idx) => (
                          <p key={idx} className="text-xs text-gray-600 dark:text-gray-400">Row {u.row}: {u.email} — {u.reason}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {importResults.errors.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-3">
                      <p className="font-medium text-red-700 dark:text-red-300 mb-1">✗ Errors ({importResults.errors.length})</p>
                      <div className="max-h-24 overflow-y-auto space-y-1">
                        {importResults.errors.map((u, idx) => (
                          <p key={idx} className="text-xs text-gray-600 dark:text-gray-400">Row {u.row}: {u.email || '(no email)'} — {u.reason}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {importResults.created.length > 0 && (
                    <p className="text-xs text-gray-400">
                      💡 Save these temporary passwords now — they won't be shown again. Ask users to change their password after first login.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={handleImport} disabled={importing || !importFile}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
                  {importing ? 'Importing...' : 'Import'}
                </button>
                <button onClick={() => { setShowImport(false); setImportFile(null); setImportResults(null); }}
                        className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition">
                  {importResults ? 'Close' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* ── User Files Modal — super admin only, GDPR/Support use ── */}
      {filesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-white">Files — {filesModal.userName}</h2>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
                  🔒 Data Management · GDPR/Support Use Only · Access is audit logged
                </p>
              </div>
              <button onClick={() => setFilesModal(null)} className="text-gray-400 hover:text-gray-600 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {filesModal.loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
                  <span className="ml-3 text-sm text-gray-500">Loading files...</span>
                </div>
              ) : filesModal.files.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400 text-sm">No files found for this user.</p>
                  <p className="text-gray-300 text-xs mt-1">Cloudinary path: {filesModal.cloudinaryPath}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 mb-4">{filesModal.total} file{filesModal.total !== 1 ? 's' : ''} found</p>
                  {filesModal.files.map((file, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                            {file.type}
                          </span>
                          {file.ticket_id && (
                            <span className="text-xs text-gray-400">INC-{String(file.ticket_id).padStart(4,'0')}</span>
                          )}
                          {file.size_kb && (
                            <span className="text-xs text-gray-400">{file.size_kb} KB</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 truncate">
                          {file.filename || file.public_id?.split('/').pop() || 'File'}
                        </p>
                        {file.ticket_title && (
                          <p className="text-xs text-gray-400 truncate">{file.ticket_title}</p>
                        )}
                      </div>
                      {file.signed_url && (
                        <a href={file.signed_url} target="_blank" rel="noreferrer"
                           className="flex-shrink-0 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                          </svg>
                          Download
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
              <p className="text-xs text-gray-400 text-center">
                Download links expire in 1 hour · Access to this panel is recorded in the system audit log
              </p>
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
}
