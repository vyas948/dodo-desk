import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { useBranding } from '../contexts/BrandingContext';
import { API } from '../api';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const DEPARTMENTS = ['Management','HR','IT','Finance','Operations','Sales & Marketing','Legal','Other Department'];

export default function Settings() {
  const { token, user, setUser } = useAuth();
  const { t, setLanguage } = useTranslation();
  const { toast } = useToast();
  const { refreshBranding } = useBranding();
  const [profile, setProfile] = useState({ full_name: '', email: '', language: 'en', theme: 'light', job_title: '', department: '' });
  const [password, setPassword] = useState({ current: '', new: '', confirm: '' });
  const [photoFile, setPhotoFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Email config state (admin only)
  const [emailCfg, setEmailCfg] = useState({
    smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '',
    smtp_from: 'noreply@itsm.local',
    slack_webhook_url: '', teams_webhook_url: '',
  });
  const [testEmail, setTestEmail] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);

  // Escalation rules state (admin only)
  const [escalationRules, setEscalationRules] = useState([]);
  const [escalationForm, setEscalationForm] = useState({ name: '', priority: '', idle_hours: 24, escalate_to_id: '', escalate_to_role: 'agent' });
  const [showEscalationForm, setShowEscalationForm] = useState(false);
  const [agentList, setAgentList] = useState([]);
  const [escalationMsg, setEscalationMsg] = useState('');

  // Business hours state (admin only)
  const [bizHours, setBizHours] = useState({
    enabled: false, start_hour: 9, end_hour: 17,
    working_days: '0,1,2,3,4', timezone: 'UTC',
  });
  const [bizMsg, setBizMsg] = useState('');
  const [bizErr, setBizErr] = useState('');
  const [bizSaving, setBizSaving] = useState(false);

  // SLA config state (admin only)
  const [slaCfg, setSlaCfg] = useState({
    low_response: 8,      low_resolution: 72,
    medium_response: 4,   medium_resolution: 48,
    high_response: 2,     high_resolution: 24,
    critical_response: 1, critical_resolution: 8,
  });
  const [slaMsg, setSlaMsg] = useState('');
  const [slaErr, setSlaErr] = useState('');
  const [slaSaving, setSlaSaving] = useState(false);

  // Branding state (admin only)
  const [branding, setBranding] = useState({
    company_name: '', company_tagline: '',
    primary_color: '#4f46e5', accent_color: '#818cf8',
    support_email: '',
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [brandingMsg, setBrandingMsg] = useState('');
  const [brandingErr, setBrandingErr] = useState('');
  const [brandingSaving, setBrandingSaving] = useState(false);

  const [secCfg, setSecCfg] = useState({
    mfa_enabled: false, mfa_required: false,
    sso_enabled: false, sso_provider: 'google',
    sso_client_id: '', sso_client_secret: '',
    sso_domain: '', sso_tenant_id: '',
  });
  const [secMsg, setSecMsg] = useState('');
  const [secErr, setSecErr] = useState('');
  const [secSaving, setSecSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setProfile({
      full_name: user.full_name || '',
      email: user.email || '',
      language: user.language || 'en',
      theme: user.theme || 'light',
      job_title: user.job_title || '',
      department: user.department || '',
    });

    if (user.profile_photo) {
      fetch(`${API}/users/me/photo`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => { if (!res.ok) throw new Error('No photo'); return res.blob(); })
        .then(blob => setPreview(URL.createObjectURL(blob)))
        .catch(() => setPreview(null));
    } else {
      setPreview(null);
    }

    if (user.role === 'admin') {
      apiFetch('/admin/email-config', token)
        .then(data => setEmailCfg(prev => ({ ...prev, ...data, smtp_pass: '' })))
        .catch(() => {});
      apiFetch('/admin/escalation-rules', token)
        .then(data => setEscalationRules(Array.isArray(data) ? data : []))
        .catch(() => {});
      apiFetch('/users/', token)
        .then(data => setAgentList(Array.isArray(data) ? data.filter(u => u.role === 'agent' || u.role === 'admin') : []))
        .catch(() => {});
      apiFetch('/admin/security-config', token)
        .then(data => setSecCfg(prev => ({ ...prev, ...data, sso_client_secret: '' })))
        .catch(() => {});
      apiFetch('/admin/business-hours', token)
        .then(data => setBizHours(data))
        .catch(() => {});
      apiFetch('/admin/sla-config', token)
        .then(data => setSlaCfg(data))
        .catch(() => {});
      apiFetch('/admin/branding', token)
        .then(data => {
          setBranding(data);
          if (data.logo_url) setLogoPreview(`${API}${data.logo_url}`);
        })
        .catch(() => {});
      apiFetch('/admin/branding', token)
        .then(data => {
          setBranding(data);
          if (data.logo_url) setLogoPreview(`${API}${data.logo_url}`);
        })
        .catch(() => {});
    }
  }, [user, token]);

  const handleProfileUpdate = async () => {
    setMsg('');
    setErr('');
    try {
      const res = await fetch(`${API}/users/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to update profile');
      }
      const updated = await res.json();
      setUser(updated);
      if (updated.language) setLanguage(updated.language);
      toast.success(t('settings.profileUpdated') || 'Profile updated successfully.');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handlePasswordChange = async () => {
    setMsg('');
    setErr('');
    if (password.new !== password.confirm) {
      toast.error(t('settings.passwordMismatch') || 'Passwords do not match.');
      return;
    }
    try {
      const res = await fetch(`${API}/users/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: password.current, new_password: password.new }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to change password');
      }
      setPassword({ current: '', new: '', confirm: '' });
      toast.success(t('settings.passwordChanged') || 'Password changed successfully.');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handlePhotoUpload = async () => {
    setMsg('');
    setErr('');
    if (!photoFile) return;
    const formData = new FormData();
    formData.append('file', photoFile);
    try {
      const res = await fetch(`${API}/users/me/photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to upload photo');
      }
      // Refresh the preview
      const photoRes = await fetch(`${API}/users/me/photo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (photoRes.ok) {
        const blob = await photoRes.blob();
        setPreview(URL.createObjectURL(blob));
      }
      setPhotoFile(null);
      setMsg(t('settings.photoUpdated'));
      // Refresh user context to update the header avatar
      const meRes = await fetch(`${API}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updatedUser = await meRes.json();
      setUser(updatedUser);
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleCreateEscalationRule = async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/admin/escalation-rules', token, {
        method: 'POST',
        body: JSON.stringify(escalationForm),
      });
      setEscalationMsg('Rule created.');
      setShowEscalationForm(false);
      setEscalationForm({ name: '', priority: '', idle_hours: 24, escalate_to_id: '', escalate_to_role: 'agent' });
      const data = await apiFetch('/admin/escalation-rules', token);
      setEscalationRules(Array.isArray(data) ? data : []);
    } catch (e) { toast.error(e.message); }
  };

  const handleDeleteEscalationRule = async (id) => {
    if (!confirm('Delete this rule?')) return;
    try {
      await apiFetch(`/admin/escalation-rules/${id}`, token, { method: 'DELETE' });
      setEscalationRules(prev => prev.filter(r => r.id !== id));
      setEscalationMsg('Rule deleted.');
    } catch (e) { toast.error(e.message); }
  };

  const handleBizHoursSave = async () => {
    setBizMsg(''); setBizErr(''); setBizSaving(true);
    try {
      await apiFetch('/admin/business-hours', token, {
        method: 'PUT',
        body: JSON.stringify(bizHours),
      });
      setBizMsg('Business hours saved.');
    } catch (e) { setBizErr(e.message); }
    finally { setBizSaving(false); }
  };

  const handleBrandingSave = async () => {
    setBrandingSaving(true);
    try {
      await apiFetch('/admin/branding', token, {
        method: 'PUT',
        body: JSON.stringify(branding),
      });
      if (logoFile) {
        const formData = new FormData();
        formData.append('file', logoFile);
        const logoRes = await fetch(`${API}/admin/branding/logo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (logoRes.ok) {
          const logoData = await logoRes.json();
          setLogoPreview(`${API}${logoData.logo_url}`);
        }
        setLogoFile(null);
      }
      // Refresh user context so BrandingContext picks up the new values immediately
      const updated = await apiFetch('/users/me', token);
      setUser(updated);
      // Refresh branding context so sidebar updates immediately
      await refreshBranding();
      toast.success('Branding updated successfully.');
    } catch (e) { toast.error(e.message); }
    finally { setBrandingSaving(false); }
  };

  const handleSlaSave = async () => {
    setSlaSaving(true);
    try {
      await apiFetch('/admin/sla-config', token, {
        method: 'PUT',
        body: JSON.stringify(slaCfg),
      });
      toast.success('SLA configuration saved.');
    } catch (e) { toast.error(e.message); }
    finally { setSlaSaving(false); }
  };

  const handleEmailConfigSave = async () => {
    setEmailSaving(true);
    try {
      await apiFetch('/admin/email-config', token, {
        method: 'PUT',
        body: JSON.stringify(emailCfg),
      });
      toast.success('Email configuration saved.');
      setEmailCfg(prev => ({ ...prev, smtp_pass: '' }));
    } catch (e) { toast.error(e.message); }
    finally { setEmailSaving(false); }
  };

  const handleTestEmail = async () => {
    setEmailTesting(true);
    try {
      const res = await apiFetch('/admin/email-config/test', token, {
        method: 'POST',
        body: JSON.stringify({ ...emailCfg, test_email: testEmail }),
      });
      toast.success(res.message || 'Test email sent!');
    } catch (e) { toast.error(e.message); }
    finally { setEmailTesting(false); }
  };

  // Dark mode classes
  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const inputClass = "w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const selectClass = "w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const btnClass = "bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-indigo-700 transition";
  const disabledBtnClass = "bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm opacity-50 cursor-not-allowed";

  const isAdmin = user?.role === 'admin';

  const handleSecuritySave = async () => {
    setSecSaving(true);
    try {
      await apiFetch('/admin/security-config', token, {
        method: 'PUT', body: JSON.stringify(secCfg),
      });
      toast.success('Security settings saved.');
    } catch (e) { toast.error(e.message); }
    finally { setSecSaving(false); }
  };

  const TABS = [
    { key: 'profile', label: '👤 Profile' },
    ...(isAdmin ? [
      { key: 'branding', label: '🎨 Branding' },
      { key: 'sla', label: '⏱ SLA & Escalation' },
      { key: 'notifications', label: '🔔 Notifications' },
      { key: 'security', label: '🔐 Security' },
    ] : []),
  ];

  const [activeTab, setActiveTab] = useState('profile');

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('common.settings')}</h1>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 flex-wrap">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                      activeTab === tab.key
                        ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-6">
        {activeTab === 'profile' && <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{t('settings.profile')}</h2>
          <div>
            <label className={labelClass}>{t('settings.fullName')}</label>
            <input
              type="text"
              value={profile.full_name}
              onChange={e => setProfile({ ...profile, full_name: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('common.email')}</label>
            <input
              type="email"
              value={profile.email}
              onChange={e => setProfile({ ...profile, email: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Job Title</label>
            <input
              type="text"
              value={profile.job_title || ''}
              onChange={e => setProfile({ ...profile, job_title: e.target.value })}
              placeholder="e.g. IT Manager, Support Analyst"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Department</label>
            <select value={profile.department || ''} onChange={e => setProfile({ ...profile, department: e.target.value })} className={inputClass}>
              <option value="">— Select Department —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('settings.language')}</label>
            <select
              value={profile.language}
              onChange={e => setProfile({ ...profile, language: e.target.value })}
              className={selectClass}
            >
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Theme</label>
            <select
              value={profile.theme}
              onChange={e => setProfile({ ...profile, theme: e.target.value })}
              className={selectClass}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <button onClick={handleProfileUpdate} className={btnClass}>
            {t('common.save')}
          </button>
        </div>}

        {/* Password Section */}
        {activeTab === 'profile' && <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{t('settings.changePassword')}</h2>
          <div>
            <label className={labelClass}>{t('settings.currentPassword')}</label>
            <input
              type="password"
              value={password.current}
              onChange={e => setPassword({ ...password, current: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('settings.newPassword')}</label>
            <input
              type="password"
              value={password.new}
              onChange={e => setPassword({ ...password, new: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('settings.confirmPassword')}</label>
            <input
              type="password"
              value={password.confirm}
              onChange={e => setPassword({ ...password, confirm: e.target.value })}
              className={inputClass}
            />
          </div>
          <button onClick={handlePasswordChange} className={btnClass}>
            {t('settings.updatePassword')}
          </button>
        </div>}

        {/* Profile Photo Section */}
        {activeTab === 'profile' && <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{t('settings.profilePhoto')}</h2>
          {preview && (
            <div className="flex items-center gap-4">
              <img src={preview} alt="Profile" className="w-16 h-16 rounded-full object-cover" />
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('settings.currentPhoto')}</span>
            </div>
          )}
          <div>
            <label className={labelClass}>{t('settings.uploadPhoto')}</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={e => setPhotoFile(e.target.files[0])}
              className="w-full text-sm text-gray-700 dark:text-gray-300"
            />
          </div>
          <button
            onClick={handlePhotoUpload}
            disabled={!photoFile}
            className={photoFile ? btnClass : disabledBtnClass}
          >
            {t('settings.uploadPhoto')}
          </button>
        </div>}

        {/* Branding Configuration — admin only */}
        {activeTab === 'branding' && user?.role === 'admin' && (
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">🎨 Portal Branding</h2>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Company Name</label>
                <input type="text" value={branding.company_name}
                       onChange={e => setBranding({...branding, company_name: e.target.value})}
                       placeholder="Acme Corp" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Tagline</label>
                <input type="text" value={branding.company_tagline}
                       onChange={e => setBranding({...branding, company_tagline: e.target.value})}
                       placeholder="IT Support Portal" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Support Email</label>
                <input type="email" value={branding.support_email}
                       onChange={e => setBranding({...branding, support_email: e.target.value})}
                       placeholder="support@company.com" className={inputClass} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Primary Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={branding.primary_color}
                           onChange={e => setBranding({...branding, primary_color: e.target.value})}
                           className="w-10 h-10 rounded cursor-pointer border border-gray-300 dark:border-gray-600" />
                    <input type="text" value={branding.primary_color}
                           onChange={e => setBranding({...branding, primary_color: e.target.value})}
                           placeholder="#4f46e5" className={`${inputClass} flex-1`} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Accent Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={branding.accent_color}
                           onChange={e => setBranding({...branding, accent_color: e.target.value})}
                           className="w-10 h-10 rounded cursor-pointer border border-gray-300 dark:border-gray-600" />
                    <input type="text" value={branding.accent_color}
                           onChange={e => setBranding({...branding, accent_color: e.target.value})}
                           placeholder="#818cf8" className={`${inputClass} flex-1`} />
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass}>Company Logo</label>
                {logoPreview && (
                  <div className="mb-3 flex items-center gap-3">
                    <img src={logoPreview} alt="Logo preview" className="h-12 w-auto object-contain rounded border border-gray-200 dark:border-gray-600 p-1 bg-white" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">Current logo</span>
                  </div>
                )}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                       onChange={e => {
                         const f = e.target.files[0];
                         if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); }
                       }}
                       className="w-full text-sm text-gray-700 dark:text-gray-300" />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PNG, JPEG, SVG or WebP. Max 2 MB. Recommended: 200×60px.</p>
              </div>

              {/* Live preview */}
              <div className="mt-4 p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">Sidebar preview</p>
                <div className="flex items-center gap-2 p-3 rounded-lg" style={{backgroundColor: branding.primary_color}}>
                  {logoPreview && <img src={logoPreview} alt="" className="w-6 h-6 object-contain rounded" />}
                  <span className="text-white font-bold text-sm">{branding.company_name || 'ITSM Portal'}</span>
                  {branding.company_tagline && <span className="text-white/60 text-xs">{branding.company_tagline}</span>}
                </div>
              </div>
            </div>

            <button onClick={handleBrandingSave} disabled={brandingSaving} className={`${btnClass} mt-4 disabled:opacity-50`}>
              {brandingSaving ? 'Saving...' : 'Save Branding'}
            </button>
            
            
          </div>
        )}

        {/* Escalation Rules — admin only */}
        {activeTab === 'sla' && user?.role === 'admin' && (
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">🔺 Escalation Rules</h2>
              <button onClick={() => setShowEscalationForm(true)}
                      className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition">
                + Add Rule
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Automatically reassign tickets that have been idle for too long.
            </p>

            {showEscalationForm && (
              <form onSubmit={handleCreateEscalationRule} className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-4 space-y-3">
                <div>
                  <label className={labelClass}>Rule Name</label>
                  <input type="text" value={escalationForm.name} required
                         onChange={e => setEscalationForm({...escalationForm, name: e.target.value})}
                         placeholder="e.g. Escalate critical after 2h" className={inputClass} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Priority Filter</label>
                    <select value={escalationForm.priority}
                            onChange={e => setEscalationForm({...escalationForm, priority: e.target.value})}
                            className={inputClass}>
                      <option value="">All priorities</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Idle Hours</label>
                    <input type="number" min="1" value={escalationForm.idle_hours}
                           onChange={e => setEscalationForm({...escalationForm, idle_hours: parseInt(e.target.value)})}
                           className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Escalate To</label>
                  <select value={escalationForm.escalate_to_id}
                          onChange={e => setEscalationForm({...escalationForm, escalate_to_id: e.target.value})}
                          className={inputClass}>
                    <option value="">Any available agent</option>
                    {agentList.map(a => <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className={btnClass}>Create Rule</button>
                  <button type="button" onClick={() => setShowEscalationForm(false)}
                          className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm">Cancel</button>
                </div>
              </form>
            )}

            {escalationRules.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No escalation rules yet.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {escalationRules.map(rule => (
                  <div key={rule.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-white">{rule.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {rule.priority ? `${rule.priority} priority · ` : 'All priorities · '}
                        idle {rule.idle_hours}h → {rule.escalate_to_name || 'any agent'}
                      </p>
                    </div>
                    <button onClick={() => handleDeleteEscalationRule(rule.id)}
                            className="text-red-500 hover:underline text-sm">Delete</button>
                  </div>
                ))}
              </div>
            )}
            {escalationMsg && <p className="text-sm text-green-600 dark:text-green-400 mt-3">{escalationMsg}</p>}
          </div>
        )}

        {/* Business Hours Configuration — admin only */}
        {activeTab === 'sla' && user?.role === 'admin' && (
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">🕘 Business Hours</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">When enabled, SLA timers only count during business hours and skip weekends.</p>

            <div className="flex items-center gap-3 mb-4">
              <input type="checkbox" id="biz-enabled" checked={bizHours.enabled}
                     onChange={e => setBizHours({...bizHours, enabled: e.target.checked})}
                     className="w-4 h-4 rounded text-indigo-600" />
              <label htmlFor="biz-enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enable business hours SLA
              </label>
            </div>

            {bizHours.enabled && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Start Hour</label>
                    <select value={bizHours.start_hour}
                            onChange={e => setBizHours({...bizHours, start_hour: parseInt(e.target.value)})}
                            className={inputClass}>
                      {Array.from({length: 24}, (_, i) => (
                        <option key={i} value={i}>{i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i-12}:00 PM`}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>End Hour</label>
                    <select value={bizHours.end_hour}
                            onChange={e => setBizHours({...bizHours, end_hour: parseInt(e.target.value)})}
                            className={inputClass}>
                      {Array.from({length: 24}, (_, i) => (
                        <option key={i} value={i}>{i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i-12}:00 PM`}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Working Days</label>
                  <div className="flex gap-2 flex-wrap">
                    {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day, i) => {
                      const days = bizHours.working_days.split(',').map(Number);
                      const active = days.includes(i);
                      return (
                        <button key={i} type="button"
                                onClick={() => {
                                  const d = bizHours.working_days.split(',').map(Number);
                                  const next = active ? d.filter(x => x !== i) : [...d, i].sort();
                                  setBizHours({...bizHours, working_days: next.join(',')});
                                }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                                  active ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                }`}>
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Timezone</label>
                  <select value={bizHours.timezone}
                          onChange={e => setBizHours({...bizHours, timezone: e.target.value})}
                          className={inputClass}>
                    {['UTC','Europe/London','Europe/Paris','Africa/Nairobi','America/New_York','America/Chicago','America/Los_Angeles','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Australia/Sydney'].map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>

                <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                  💡 With current settings, business hours are <strong>{bizHours.start_hour}:00–{bizHours.end_hour}:00</strong> ({bizHours.end_hour - bizHours.start_hour}h/day).
                  A "4 hour" SLA for a ticket submitted at 4 PM would be due the next morning.
                </div>
              </div>
            )}

            <button onClick={handleBizHoursSave} disabled={bizSaving}
                    className={`${btnClass} mt-4 disabled:opacity-50`}>
              {bizSaving ? 'Saving...' : 'Save Business Hours'}
            </button>
            {bizMsg && <div className="mt-3 p-3 bg-green-50 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg text-sm">{bizMsg}</div>}
            {bizErr && <div className="mt-3 p-3 bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-lg text-sm">{bizErr}</div>}
          </div>
        )}

        {/* SLA Configuration — admin only */}
        {activeTab === 'sla' && user?.role === 'admin' && (
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">⏱ SLA Configuration</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Set response and resolution time targets (in hours) per priority level. These apply to all new tickets.</p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Priority</th>
                    <th className="pb-3 pr-4">Response (hours)</th>
                    <th className="pb-3">Resolution (hours)</th>
                  </tr>
                </thead>
                <tbody className="space-y-2">
                  {[
                    { key: 'low',      label: 'Low',      color: 'text-green-600 dark:text-green-400' },
                    { key: 'medium',   label: 'Medium',   color: 'text-blue-600 dark:text-blue-400' },
                    { key: 'high',     label: 'High',     color: 'text-orange-600 dark:text-orange-400' },
                    { key: 'critical', label: 'Critical', color: 'text-red-600 dark:text-red-400' },
                  ].map(({ key, label, color }) => (
                    <tr key={key}>
                      <td className={`py-2 pr-4 font-medium ${color}`}>{label}</td>
                      <td className="py-2 pr-4">
                        <input
                          type="number" min="1" max="999"
                          value={slaCfg[`${key}_response`]}
                          onChange={e => setSlaCfg({ ...slaCfg, [`${key}_response`]: parseInt(e.target.value) || 1 })}
                          className={`${inputClass} w-24`}
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="number" min="1" max="9999"
                          value={slaCfg[`${key}_resolution`]}
                          onChange={e => setSlaCfg({ ...slaCfg, [`${key}_resolution`]: parseInt(e.target.value) || 1 })}
                          className={`${inputClass} w-24`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={handleSlaSave} disabled={slaSaving} className={`${btnClass} mt-4 disabled:opacity-50`}>
              {slaSaving ? 'Saving...' : 'Save SLA Configuration'}
            </button>
            
            
          </div>
        )}

        {/* Email & Webhook Configuration — admin only */}
        {activeTab === 'notifications' && user?.role === 'admin' && (
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">📧 Email & Webhook Configuration</h2>
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3">SMTP Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div><label className={labelClass}>SMTP Host</label><input type="text" value={emailCfg.smtp_host} onChange={e => setEmailCfg({...emailCfg, smtp_host: e.target.value})} placeholder="smtp.gmail.com" className={inputClass} /></div>
              <div><label className={labelClass}>SMTP Port</label><input type="number" value={emailCfg.smtp_port} onChange={e => setEmailCfg({...emailCfg, smtp_port: parseInt(e.target.value)})} placeholder="587" className={inputClass} /></div>
              <div><label className={labelClass}>SMTP Username</label><input type="text" value={emailCfg.smtp_user} onChange={e => setEmailCfg({...emailCfg, smtp_user: e.target.value})} placeholder="you@gmail.com" className={inputClass} /></div>
              <div><label className={labelClass}>SMTP Password</label><input type="password" value={emailCfg.smtp_pass} onChange={e => setEmailCfg({...emailCfg, smtp_pass: e.target.value})} placeholder="Leave blank to keep current" className={inputClass} /></div>
              <div className="col-span-2"><label className={labelClass}>From Address</label><input type="text" value={emailCfg.smtp_from} onChange={e => setEmailCfg({...emailCfg, smtp_from: e.target.value})} placeholder="ITSM Portal <noreply@company.com>" className={inputClass} /></div>
            </div>
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3 mt-6">Webhooks</h3>
            <div className="space-y-3 mb-4">
              <div><label className={labelClass}>Slack Webhook URL</label><input type="text" value={emailCfg.slack_webhook_url} onChange={e => setEmailCfg({...emailCfg, slack_webhook_url: e.target.value})} placeholder="https://hooks.slack.com/services/..." className={inputClass} /></div>
              <div><label className={labelClass}>Microsoft Teams Webhook URL</label><input type="text" value={emailCfg.teams_webhook_url} onChange={e => setEmailCfg({...emailCfg, teams_webhook_url: e.target.value})} placeholder="https://outlook.office.com/webhook/..." className={inputClass} /></div>
            </div>
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3 mt-6">Send Test Email</h3>
            <div className="flex gap-2 mb-4">
              <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder={user?.email || 'test@example.com'} className={`${inputClass} flex-1`} />
              <button onClick={handleTestEmail} disabled={emailTesting} className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 transition disabled:opacity-50 whitespace-nowrap">
                {emailTesting ? 'Sending...' : 'Send Test'}
              </button>
            </div>
            <button onClick={handleEmailConfigSave} disabled={emailSaving} className={`${btnClass} disabled:opacity-50`}>
              {emailSaving ? 'Saving...' : 'Save Configuration'}
            </button>
            
            
          </div>
        )}

        {activeTab === 'security' && user?.role === 'admin' && (
          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1">🔑 Multi-Factor Authentication (MFA)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">TOTP-based MFA (Google Authenticator, Authy). When enabled, users can enroll from their profile.</p>
            <div className="space-y-3 mb-6">
              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <input type="checkbox" checked={secCfg.mfa_enabled}
                       onChange={e => setSecCfg({...secCfg, mfa_enabled: e.target.checked, mfa_required: e.target.checked ? secCfg.mfa_required : false})}
                       className="w-4 h-4 rounded text-indigo-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white">Enable MFA</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Allow users to voluntarily enroll in MFA</p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${secCfg.mfa_enabled ? 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50' : 'border-gray-100 dark:border-gray-800 opacity-40 pointer-events-none'}`}>
                <input type="checkbox" checked={secCfg.mfa_required} disabled={!secCfg.mfa_enabled}
                       onChange={e => setSecCfg({...secCfg, mfa_required: e.target.checked})}
                       className="w-4 h-4 rounded text-indigo-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white">Require MFA for all users</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Users must set up MFA before accessing the portal</p>
                </div>
              </label>
            </div>
            <hr className="border-gray-200 dark:border-gray-700 my-5" />
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1">🔗 Single Sign-On (SSO)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Allow users to log in with their corporate identity provider.</p>
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 mb-4">
              <input type="checkbox" checked={secCfg.sso_enabled}
                     onChange={e => setSecCfg({...secCfg, sso_enabled: e.target.checked})}
                     className="w-4 h-4 rounded text-indigo-600" />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-white">Enable SSO</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Show "Sign in with SSO" on the login page</p>
              </div>
            </label>
            {secCfg.sso_enabled && (
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Identity Provider</label>
                  <select value={secCfg.sso_provider} onChange={e => setSecCfg({...secCfg, sso_provider: e.target.value})} className={inputClass}>
                    <option value="google">Google Workspace</option>
                    <option value="microsoft">Microsoft Entra ID (Azure AD)</option>
                    <option value="okta">Okta</option>
                    <option value="saml">Generic SAML 2.0</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Client ID / App ID</label>
                    <input type="text" value={secCfg.sso_client_id} onChange={e => setSecCfg({...secCfg, sso_client_id: e.target.value})}
                           placeholder={secCfg.sso_provider === 'google' ? '123456789.apps.googleusercontent.com' : 'Your client ID'} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Client Secret</label>
                    <input type="password" value={secCfg.sso_client_secret} onChange={e => setSecCfg({...secCfg, sso_client_secret: e.target.value})}
                           placeholder="Leave blank to keep current" className={inputClass} />
                  </div>
                  {secCfg.sso_provider === 'microsoft' && (
                    <div>
                      <label className={labelClass}>Tenant ID</label>
                      <input type="text" value={secCfg.sso_tenant_id} onChange={e => setSecCfg({...secCfg, sso_tenant_id: e.target.value})}
                             placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputClass} />
                    </div>
                  )}
                  <div>
                    <label className={labelClass}>Allowed Domain</label>
                    <input type="text" value={secCfg.sso_domain} onChange={e => setSecCfg({...secCfg, sso_domain: e.target.value})}
                           placeholder="company.com" className={inputClass} />
                  </div>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">📋 Redirect URI — add this to your identity provider</p>
                  <code className="text-xs text-blue-800 dark:text-blue-200 break-all">{window.location.origin}/auth/sso/callback</code>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button onClick={handleSecuritySave} disabled={secSaving}
                      className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                {secSaving ? 'Saving...' : 'Save Security Settings'}
              </button>
              
              
            </div>
          </div>
        )}

        {activeTab === 'profile' && msg && <></>}
        {activeTab === 'profile' && err && <></>}
        </div>
      </div>
    </Layout>
  );
}