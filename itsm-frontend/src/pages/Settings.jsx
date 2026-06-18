import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const brandingCtx = useBranding();
  const { refreshBranding } = brandingCtx;
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
    support_email: '', logo_url: '',
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  // MFA enrollment
  const [mfaStatus, setMfaStatus] = useState({ mfa_enabled: false, backup_codes_remaining: 0 });
  const [mfaSetup, setMfaSetup] = useState(null); // { secret, provisioning_uri }
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBackupCodes, setMfaBackupCodes] = useState(null);
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState('');
  const [brandingErr, setBrandingErr] = useState('');
  const [brandingSaving, setBrandingSaving] = useState(false);

  // Tenants
  const [tenants, setTenants] = useState([]);
  const [billingConfig, setBillingConfig] = useState(null);
  const [billingInterval, setBillingInterval] = useState('month');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [showTenantForm, setShowTenantForm] = useState(false);
  const [editingTenantId, setEditingTenantId] = useState(null);
  const EMPTY_TENANT = { name: '', slug: '', admin_email: '', admin_password: '', admin_name: '', support_email: '', company_tagline: '', primary_color: '#4f46e5', accent_color: '#818cf8', logo_url: '' };
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT);
  const [tenantLogoFile, setTenantLogoFile] = useState(null);
  const [tenantSaving, setTenantSaving] = useState(false);

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

    if ((user.role === 'admin' || user.role === 'super_admin')) {
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
      apiFetch('/superadmin/tenants', token)
        .then(data => setTenants(Array.isArray(data) ? data : []))
        .catch(() => {});
      apiFetch('/admin/business-hours', token)
        .then(data => setBizHours(data))
        .catch(() => {});
      apiFetch('/admin/sla-config', token)
        .then(data => setSlaCfg(data))
        .catch(() => {});
      apiFetch('/admin/branding', token)
        .then(data => {
          setBranding(prev => ({ ...prev, ...data }));
          if (data.logo_url) {
            setLogoPreview(data.logo_url.startsWith('http') ? data.logo_url : `${API}${data.logo_url}`);
          }
          setBrandingLoaded(true);
        })
        .catch(() => {});
    }
  }, [user, token]);

  // Load billing config (for non-super-admin tenant admins)
  useEffect(() => {
    if (!user || user.role === 'super_admin') return;
    apiFetch('/billing/config', token)
      .then(data => setBillingConfig(data))
      .catch(() => {});
  }, [user, token]);

  // Load MFA status
  useEffect(() => {
    if (!user) return;
    apiFetch('/users/me/mfa/status', token)
      .then(data => setMfaStatus(data))
      .catch(() => {});
  }, [user, token]);

  const handleMfaSetupStart = async () => {
    setMfaLoading(true);
    try {
      const data = await apiFetch('/users/me/mfa/setup', token, { method: 'POST' });
      setMfaSetup(data);
      setMfaCode('');
    } catch (err) { toast.error(err.message); }
    finally { setMfaLoading(false); }
  };

  const handleMfaConfirm = async () => {
    if (!mfaCode || mfaCode.length !== 6) { toast.error('Enter the 6-digit code from your app.'); return; }
    setMfaLoading(true);
    try {
      const data = await apiFetch('/users/me/mfa/confirm', token, { method: 'POST', body: JSON.stringify({ code: mfaCode }) });
      setMfaBackupCodes(data.backup_codes);
      setMfaSetup(null);
      setMfaCode('');
      setMfaStatus({ mfa_enabled: true, backup_codes_remaining: data.backup_codes.length });
      toast.success('MFA enabled successfully!');
    } catch (err) { toast.error(err.message); }
    finally { setMfaLoading(false); }
  };

  const handleMfaDisable = async () => {
    if (!mfaDisablePassword) { toast.error('Enter your password to disable MFA.'); return; }
    setMfaLoading(true);
    try {
      await apiFetch('/users/me/mfa/disable', token, { method: 'POST', body: JSON.stringify({ password: mfaDisablePassword }) });
      setMfaStatus({ mfa_enabled: false, backup_codes_remaining: 0 });
      setMfaDisablePassword('');
      setMfaBackupCodes(null);
      toast.success('MFA disabled.');
    } catch (err) { toast.error(err.message); }
    finally { setMfaLoading(false); }
  };
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
    setBizSaving(true);
    try {
      await apiFetch('/admin/business-hours', token, {
        method: 'PUT',
        body: JSON.stringify(bizHours),
      });
      toast.success('Business hours saved.');
    } catch (e) { toast.error(e.message); }
    finally { setBizSaving(false); }
  };

  const handleBrandingSave = async () => {
    setBrandingSaving(true);
    try {
      // Save branding settings (logo_url preserved in branding state)
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
          const newLogoUrl = logoData.logo_url;
          // Update branding state with new logo URL
          setBranding(prev => ({ ...prev, logo_url: newLogoUrl }));
          // Handle both Cloudinary URLs and local paths
          setLogoPreview(newLogoUrl.startsWith('http') ? newLogoUrl : `${API}${newLogoUrl}`);
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

  const isAdmin = (user?.role === 'admin' || user?.role === 'super_admin');

  const autoSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

  const fetchTenants = () => apiFetch('/superadmin/tenants', token)
    .then(data => setTenants(Array.isArray(data) ? data : [])).catch(() => {});

  const handleTenantSave = async (e) => {
    e.preventDefault();
    setTenantSaving(true);
    try {
      if (editingTenantId) {
        await apiFetch(`/superadmin/tenants/${editingTenantId}`, token, {
          method: 'PATCH',
          body: JSON.stringify({
            name: tenantForm.name,
            support_email: tenantForm.support_email,
            company_tagline: tenantForm.company_tagline,
            primary_color: tenantForm.primary_color,
            accent_color: tenantForm.accent_color,
          }),
        });
        // Upload logo if a new one was selected
        if (tenantLogoFile) {
          const formData = new FormData();
          formData.append('file', tenantLogoFile);
          formData.append('tenant_id', editingTenantId);
          await fetch(`${API}/superadmin/tenants/${editingTenantId}/logo`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          });
          setTenantLogoFile(null);
        }
        // Clear cached branding so fresh values load
        try { localStorage.removeItem('dodesk_branding'); } catch {}
        toast.success('Tenant updated.');
        // Refresh branding so sidebar updates immediately
        await refreshBranding();
      } else {
        await apiFetch('/superadmin/tenants', token, { method: 'POST', body: JSON.stringify(tenantForm) });
        toast.success(`Tenant "${tenantForm.name}" created.`);
      }
      setShowTenantForm(false); setEditingTenantId(null); setTenantForm(EMPTY_TENANT);
      fetchTenants();
    } catch (err) { toast.error(err.message); }
    finally { setTenantSaving(false); }
  };

  const handleTenantToggle = async (tenant) => {
    try {
      await apiFetch(`/superadmin/tenants/${tenant.id}`, token, {
        method: 'PATCH', body: JSON.stringify({ is_active: !tenant.is_active }),
      });
      toast.success(`Tenant ${tenant.is_active ? 'deactivated' : 'activated'}.`);
      fetchTenants();
    } catch (err) { toast.error(err.message); }
  };

  const handlePlanChange = async (tenant, newPlan) => {
    try {
      await apiFetch(`/superadmin/tenants/${tenant.id}`, token, {
        method: 'PATCH', body: JSON.stringify({ plan: newPlan }),
      });
      toast.success(`${tenant.name} is now on the ${newPlan === 'enterprise' ? 'Enterprise' : newPlan === 'pro' ? 'Pro' : 'Free'} plan.`);
      fetchTenants();
    } catch (err) { toast.error(err.message); }
  };

  const loadPaddleJs = () => new Promise((resolve, reject) => {
    if (window.Paddle) { resolve(window.Paddle); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.onload = () => resolve(window.Paddle);
    script.onerror = () => reject(new Error('Failed to load Paddle.js'));
    document.body.appendChild(script);
  });

  const handleUpgrade = async (interval) => {
    if (!billingConfig?.client_token) {
      toast.error('Billing is not configured yet.');
      return;
    }
    setCheckoutLoading(true);
    try {
      const checkoutData = await apiFetch('/billing/checkout', token, {
        method: 'POST', body: JSON.stringify({ interval }),
      });
      if (!checkoutData.price_id) {
        toast.error('This plan is not available for self-serve checkout yet.');
        return;
      }
      const Paddle = await loadPaddleJs();
      Paddle.Environment.set(billingConfig.environment === 'sandbox' ? 'sandbox' : 'production');
      Paddle.Initialize({ token: billingConfig.client_token });
      Paddle.Checkout.open({
        items: [{ priceId: checkoutData.price_id, quantity: 1 }],
        customer: { email: checkoutData.customer_email },
        customData: { tenant_id: String(checkoutData.tenant_id) },
        settings: {
          successUrl: window.location.href,
        },
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const data = await apiFetch('/billing/portal', token, { method: 'POST' });
      if (data.url) window.open(data.url, '_blank');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPortalLoading(false);
    }
  };

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
      { key: 'sla', label: '⏱ SLA & Escalation' },
      { key: 'notifications', label: '🔔 Notifications' },
      { key: 'security', label: '🔐 Security' },
      { key: 'tenants', label: '🏬 Tenants' },
    ] : []),
  ];

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'profile');

  // Auto-trigger Paddle checkout if redirected here after Pro signup verification
  useEffect(() => {
    if (searchParams.get('upgrade') === '1' && billingConfig?.price_pro_monthly) {
      handleUpgrade('month');
    }
  }, [billingConfig]);

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

        {/* MFA Enrollment */}
        {activeTab === 'profile' && <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">🔐 Two-Factor Authentication (2FA)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Add an extra layer of security using an authenticator app (Google Authenticator, Authy, etc.)
          </p>

          {mfaStatus.mfa_enabled && !mfaBackupCodes && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-medium">
                ✅ 2FA is enabled
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Backup codes remaining: {mfaStatus.backup_codes_remaining}
              </p>
              <div className="pt-2">
                <label className={labelClass}>Enter your password to disable 2FA</label>
                <input type="password" value={mfaDisablePassword} onChange={e => setMfaDisablePassword(e.target.value)} className={inputClass} placeholder="Current password" />
                <button onClick={handleMfaDisable} disabled={mfaLoading} className="mt-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition disabled:opacity-50">
                  Disable 2FA
                </button>
              </div>
            </div>
          )}

          {!mfaStatus.mfa_enabled && !mfaSetup && !mfaBackupCodes && (
            brandingCtx.plan_limits && !brandingCtx.plan_limits.mfa ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                🔒 Two-factor authentication is available on the <strong>Pro</strong> plan and above.
              </div>
            ) : (
              <button onClick={handleMfaSetupStart} disabled={mfaLoading} className={btnClass}>
                {mfaLoading ? 'Loading...' : 'Set Up 2FA'}
              </button>
            )
          )}

          {mfaSetup && (
            <div className="space-y-3 border border-indigo-200 dark:border-indigo-700 rounded-lg p-4 bg-indigo-50 dark:bg-indigo-900/30">
              <p className="text-sm font-medium text-gray-800 dark:text-white">Step 1 — Add this account to your authenticator app</p>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">In Google Authenticator or Microsoft Authenticator, choose <strong>"Enter a setup key"</strong> (manual entry) and use:</p>
                <div className="grid grid-cols-[80px_1fr] gap-1 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Account:</span>
                  <span className="font-mono">{user?.email}</span>
                  <span className="text-gray-500 dark:text-gray-400">Key:</span>
                  <span className="font-mono font-semibold tracking-wider break-all">{mfaSetup.secret}</span>
                  <span className="text-gray-500 dark:text-gray-400">Type:</span>
                  <span className="font-mono">Time based</span>
                </div>
              </div>
              <details className="text-xs text-gray-500 dark:text-gray-400">
                <summary className="cursor-pointer hover:underline">Or scan a QR code instead</summary>
                <div className="bg-white p-3 rounded-lg inline-block mt-2">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(mfaSetup.provisioning_uri)}`}
                    alt="MFA QR Code" width={200} height={200}
                    onError={e => {
                      e.target.onerror = null;
                      e.target.src = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(mfaSetup.provisioning_uri)}&choe=UTF-8`;
                    }}
                  />
                </div>
              </details>
              <p className="text-sm font-medium text-gray-800 dark:text-white pt-2">Step 2 — Enter the 6-digit code</p>
              <input type="text" value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                     placeholder="000000" maxLength={6} className={`${inputClass} font-mono text-lg tracking-widest text-center w-32`} />
              <div className="flex gap-2">
                <button onClick={handleMfaConfirm} disabled={mfaLoading} className={btnClass}>
                  {mfaLoading ? 'Verifying...' : 'Confirm & Enable'}
                </button>
                <button onClick={() => { setMfaSetup(null); setMfaCode(''); }} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mfaBackupCodes && (
            <div className="space-y-3 border border-green-200 dark:border-green-700 rounded-lg p-4 bg-green-50 dark:bg-green-900/30">
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">✅ 2FA Enabled! Save your backup codes</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                If you lose access to your authenticator app, use one of these one-time codes to log in. Each code can only be used once. Store them somewhere safe.
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {mfaBackupCodes.map(code => (
                  <div key={code} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-center">{code}</div>
                ))}
              </div>
              <button onClick={() => setMfaBackupCodes(null)} className={btnClass}>
                I've Saved My Backup Codes
              </button>
            </div>
          )}
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
            <label className="flex items-center gap-3 cursor-pointer">
              <span className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition">
                Choose Photo
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400" id="photo-filename">No file chosen</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={e => {
                  setPhotoFile(e.target.files[0]);
                  if (e.target.files[0]) document.getElementById('photo-filename').textContent = e.target.files[0].name;
                }}
              />
            </label>
          </div>
          <button
            onClick={handlePhotoUpload}
            disabled={!photoFile}
            className={photoFile ? btnClass : disabledBtnClass}
          >
            {t('settings.uploadPhoto')}
          </button>
        </div>}

        {/* Escalation Rules — admin only */}
        {activeTab === 'sla' && (user?.role === 'admin' || user?.role === 'super_admin') && (
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
        {activeTab === 'sla' && (user?.role === 'admin' || user?.role === 'super_admin') && (
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
            
            
          </div>
        )}

        {/* SLA Configuration — admin only */}
        {activeTab === 'sla' && (user?.role === 'admin' || user?.role === 'super_admin') && (
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
        {activeTab === 'notifications' && (user?.role === 'admin' || user?.role === 'super_admin') && (
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

        {activeTab === 'security' && (user?.role === 'admin' || user?.role === 'super_admin') && (
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

        {activeTab === 'tenants' && (user?.role === 'admin' || user?.role === 'super_admin') && (
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-800 dark:text-white">
                  {user?.role === 'super_admin' ? '🏢 Client Tenants' : '🏢 Your Company'}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {user?.role === 'super_admin' ? 'Manage client organisations on DodoDesk.' : 'Your organisation on DodoDesk.'}
                </p>
              </div>
              {user?.role === 'super_admin' && (
                <button onClick={() => { setShowTenantForm(true); setEditingTenantId(null); setTenantForm(EMPTY_TENANT); }}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
                  New Tenant
                </button>
              )}
            </div>

            {showTenantForm && (
              <form onSubmit={handleTenantSave} className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600 space-y-4">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{editingTenantId ? 'Edit Tenant' : 'New Tenant'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Company Name *</label>
                    <input type="text" required value={tenantForm.name}
                           onChange={e => setTenantForm({ ...tenantForm, name: e.target.value, slug: editingTenantId ? tenantForm.slug : autoSlug(e.target.value) })}
                           placeholder="e.g. Acme Corp" className={inputClass} />
                  </div>
                  {!editingTenantId && (
                    <div>
                      <label className={labelClass}>Slug *</label>
                      <input type="text" required value={tenantForm.slug}
                             onChange={e => setTenantForm({ ...tenantForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                             placeholder="acme-corp" className={inputClass} />
                      <p className="text-xs text-gray-400 mt-1">Lowercase, hyphens only</p>
                    </div>
                  )}
                  <div>
                    <label className={labelClass}>Support Email</label>
                    <input type="email" value={tenantForm.support_email}
                           onChange={e => setTenantForm({ ...tenantForm, support_email: e.target.value })}
                           placeholder="support@client.com" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Company Tagline</label>
                    <input type="text" value={tenantForm.company_tagline}
                           onChange={e => setTenantForm({ ...tenantForm, company_tagline: e.target.value })}
                           placeholder="e.g. Powering your IT operations" className={inputClass} />
                  </div>
                </div>
                {!editingTenantId && (
                  <>
                    <hr className="border-gray-200 dark:border-gray-600" />
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Admin User</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Admin Name</label>
                        <input type="text" value={tenantForm.admin_name}
                               onChange={e => setTenantForm({ ...tenantForm, admin_name: e.target.value })}
                               placeholder="John Smith" className={inputClass} />
                      </div>
                      <div>
                        <label className={labelClass}>Admin Email</label>
                        <input type="email" value={tenantForm.admin_email}
                               onChange={e => setTenantForm({ ...tenantForm, admin_email: e.target.value })}
                               placeholder="admin@client.com" className={inputClass} />
                      </div>
                      <div>
                        <label className={labelClass}>Admin Password</label>
                        <input type="password" value={tenantForm.admin_password}
                               onChange={e => setTenantForm({ ...tenantForm, admin_password: e.target.value })}
                               placeholder="Min 8 characters" className={inputClass} />
                      </div>
                    </div>
                  </>
                )}
                {/* Branding — shown for both create and edit */}
                <hr className="border-gray-200 dark:border-gray-600" />
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">🎨 Branding</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Primary Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={tenantForm.primary_color || '#4f46e5'}
                             onChange={e => setTenantForm({...tenantForm, primary_color: e.target.value})}
                             className="w-10 h-10 rounded cursor-pointer border border-gray-300" />
                      <input type="text" value={tenantForm.primary_color || '#4f46e5'}
                             onChange={e => setTenantForm({...tenantForm, primary_color: e.target.value})}
                             className={`${inputClass} flex-1`} />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Accent Color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={tenantForm.accent_color || '#818cf8'}
                             onChange={e => setTenantForm({...tenantForm, accent_color: e.target.value})}
                             className="w-10 h-10 rounded cursor-pointer border border-gray-300" />
                      <input type="text" value={tenantForm.accent_color || '#818cf8'}
                             onChange={e => setTenantForm({...tenantForm, accent_color: e.target.value})}
                             className={`${inputClass} flex-1`} />
                    </div>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Company Logo</label>
                  {tenantForm.logo_url && (
                    <div className="mb-2 flex items-center gap-3">
                      <img src={tenantForm.logo_url} alt="Logo" className="h-10 object-contain rounded border border-gray-200 p-1 bg-white"
                           onError={e => { e.target.style.display = 'none'; }} />
                      <span className="text-xs text-gray-400">Current logo</span>
                      <button type="button" onClick={async () => {
                        try {
                          await apiFetch(`/superadmin/tenants/${editingTenantId || tenants[0]?.id}/logo`, token, { method: 'DELETE' });
                          setTenantForm(f => ({ ...f, logo_url: '' }));
                          toast.success('Logo removed.');
                        } catch (err) { toast.error(err.message); }
                      }} className="text-xs text-red-500 hover:text-red-700 hover:underline">
                        × Remove
                      </button>
                    </div>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <span className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 transition">Choose Logo</span>
                    <span className="text-sm text-gray-400" id="tenant-logo-filename">No file chosen</span>
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
                           onChange={e => {
                             const f = e.target.files[0];
                             if (f) { setTenantLogoFile(f); document.getElementById('tenant-logo-filename').textContent = f.name; }
                           }} />
                  </label>
                  <p className="text-xs text-gray-400 mt-1">PNG, JPEG, SVG or WebP. Max 2 MB.</p>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={tenantSaving}
                          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
                    {tenantSaving ? 'Saving...' : editingTenantId ? 'Update' : 'Create Tenant'}
                  </button>
                  <button type="button" onClick={() => { setShowTenantForm(false); setEditingTenantId(null); setTenantForm(EMPTY_TENANT); }}
                          className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-3">
              {tenants.length === 0 && !showTenantForm && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                  {user?.role === 'super_admin' ? 'No tenants yet. Click New Tenant to add your first client.' : 'No tenant information available.'}
                </p>
              )}
              {tenants.map(tenant => (
                <div key={tenant.id} className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: tenant.primary_color }} />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white">{tenant.name}</p>
                        <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{tenant.slug}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tenant.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-gray-100 text-gray-500'}`}>
                          {tenant.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          tenant.plan === 'enterprise' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                          : tenant.plan === 'pro' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {tenant.plan === 'enterprise' ? 'Enterprise' : tenant.plan === 'pro' ? 'Pro' : 'Free'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {tenant.staff_count}{tenant.max_users ? `/${tenant.max_users}` : ''} agents/admins · {tenant.user_count} total users · {tenant.ticket_count} tickets
                        {tenant.support_email && ` · ${tenant.support_email}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-center">
                    {user?.role === 'super_admin' && (
                      <select value={tenant.plan || 'free'} onChange={e => handlePlanChange(tenant, e.target.value)}
                              title="Change plan"
                              className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="enterprise">Enterprise</option>
                      </select>
                    )}
                    <button onClick={() => { setTenantForm({ ...EMPTY_TENANT, name: tenant.name, support_email: tenant.support_email || '', company_tagline: tenant.company_tagline || '', primary_color: tenant.primary_color || '#4f46e5', accent_color: tenant.accent_color || '#818cf8', logo_url: tenant.logo_url || '' }); setEditingTenantId(tenant.id); setShowTenantForm(true); }}
                            title="Edit tenant"
                            className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113 2.932L7.5 19.785 3 21l1.215-4.5L16.862 4.487z" />
                      </svg>
                    </button>
                    {user?.role === 'super_admin' && (
                    <button onClick={() => handleTenantToggle(tenant)}
                            title={tenant.is_active ? 'Deactivate tenant' : 'Activate tenant'}
                            className={`transition ${tenant.is_active ? 'text-red-400 hover:text-red-600' : 'text-green-500 hover:text-green-700'}`}>
                      {tenant.is_active ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* Plan & Usage */}
        {activeTab === 'tenants' && (user?.role === 'admin' || user?.role === 'super_admin') && user?.role !== 'super_admin' && (
          <div className={`${cardClass} mt-4`}>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">📦 Your Plan</h3>
            {brandingCtx.plan_limits ? (
              <>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                    brandingCtx.plan === 'enterprise' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                    : brandingCtx.plan === 'pro' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {brandingCtx.plan_limits.label} Plan
                  </span>
                  {billingConfig?.on_trial && !billingConfig?.trial_expired && (
                    <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      🕐 Trial: {billingConfig.trial_days_remaining} day{billingConfig.trial_days_remaining === 1 ? '' : 's'} left
                    </span>
                  )}
                  {billingConfig?.trial_expired && (
                    <span className="text-xs font-medium px-3 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                      ⏹ Trial ended
                    </span>
                  )}
                  {brandingCtx.plan !== 'enterprise' && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {brandingCtx.plan === 'free' ? 'Upgrade to Pro for full features, or contact us for Enterprise.' : 'Need more seats? Contact us about Enterprise.'}
                    </span>
                  )}
                </div>

                {billingConfig?.trial_expired && (
                  <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-xs text-red-700 dark:text-red-300">
                    ⏹ Your 14-day free trial has ended. New tickets can't be created until you upgrade to Pro.
                  </div>
                )}

                {billingConfig?.billing_status === 'past_due' && (
                  <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-700 dark:text-amber-300">
                    ⚠ Your last payment failed. Please update your payment method to avoid losing Pro access.
                  </div>
                )}

                {billingConfig?.in_grace_zone && (
                  <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-700 dark:text-amber-300">
                    ⚠ You're using {billingConfig.staff_count} agent/admin seats — {billingConfig.seats_over_limit} over your plan's {brandingCtx.plan_limits?.max_users} included seats.
                    Seats 6–10 are billed at ${brandingCtx.plan_limits?.price_per_extra_seat}/seat/month.
                    For more than 10 seats, please <a href="mailto:sales@dododesk.com" className="underline font-medium">contact us about Enterprise</a>.
                  </div>
                )}

                {brandingCtx.plan === 'free' && billingConfig?.price_pro_monthly && (
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1 text-xs">
                      <button onClick={() => setBillingInterval('month')}
                              className={`px-3 py-1 rounded-md transition ${billingInterval === 'month' ? 'bg-white dark:bg-gray-600 shadow text-gray-800 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                        Monthly — $59/mo
                      </button>
                      <button onClick={() => setBillingInterval('year')}
                              className={`px-3 py-1 rounded-md transition ${billingInterval === 'year' ? 'bg-white dark:bg-gray-600 shadow text-gray-800 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                        Annual — $637/yr <span className="text-green-600 dark:text-green-400">(save 10%)</span>
                      </button>
                    </div>
                    <button onClick={() => handleUpgrade(billingInterval)} disabled={checkoutLoading}
                            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
                      {checkoutLoading ? 'Loading...' : '⬆ Upgrade to Pro'}
                    </button>
                  </div>
                )}
                {brandingCtx.plan === 'free' && (
                  <p className="text-xs text-gray-400 mb-4">Pro includes 5 agent/admin seats (+2 grace seats). Need more? Contact us for Enterprise.</p>
                )}

                {billingConfig?.has_subscription && (
                  <div className="mb-4">
                    <button onClick={handleManageBilling} disabled={portalLoading}
                            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                      {portalLoading ? 'Opening...' : '⚙ Manage billing & subscription'}
                    </button>
                    {billingConfig.plan_renews_at && (
                      <p className="text-xs text-gray-400 mt-1">
                        Renews on {new Date(billingConfig.plan_renews_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Agent/Admin Seats</p>
                    <p className="font-semibold text-gray-800 dark:text-white">
                      {tenants[0]?.staff_count ?? '—'}{brandingCtx.plan_limits.max_users ? ` / ${brandingCtx.plan_limits.max_users}` : ' (unlimited)'}
                    </p>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Employees (Free)</p>
                    <p className="font-semibold text-gray-800 dark:text-white">
                      {Math.max((tenants[0]?.user_count ?? 0) - (tenants[0]?.staff_count ?? 0), 0)} (unlimited)
                    </p>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Custom Branding</p>
                    <p className="font-semibold text-gray-800 dark:text-white">{brandingCtx.plan_limits.branding ? '✅ Included' : '🔒 Pro & above'}</p>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">SLA Management</p>
                    <p className="font-semibold text-gray-800 dark:text-white">{brandingCtx.plan_limits.sla ? '✅ Included' : '🔒 Pro & above'}</p>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Two-Factor Auth (MFA)</p>
                    <p className="font-semibold text-gray-800 dark:text-white">{brandingCtx.plan_limits.mfa ? '✅ Included' : '🔒 Pro & above'}</p>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Approval Workflows</p>
                    <p className="font-semibold text-gray-800 dark:text-white">{brandingCtx.plan_limits.approval_workflows ? '✅ Included' : '🔒 Pro & above'}</p>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Single Sign-On (SSO)</p>
                    <p className="font-semibold text-gray-800 dark:text-white">{brandingCtx.plan_limits.sso ? '✅ Included' : '🔒 Pro & above'}</p>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Client Organisations</p>
                    <p className="font-semibold text-gray-800 dark:text-white">
                      {brandingCtx.plan_limits.max_tenants === null ? 'Unlimited' : `${brandingCtx.plan_limits.max_tenants} (your company)`}
                    </p>
                    {brandingCtx.plan_limits.max_tenants !== null && (
                      <p className="text-xs text-gray-400 mt-0.5">Enterprise for multiple clients</p>
                    )}
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">AI Support Chatbot</p>
                    <p className="font-semibold text-gray-800 dark:text-white">{brandingCtx.plan_limits.ai_chatbot ? '✅ Included' : '🔒 Enterprise only'}</p>
                    {brandingCtx.plan_limits.ai_chatbot && (
                      <p className="text-xs text-gray-400 mt-0.5">Coming soon</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400">Loading plan details...</p>
            )}
          </div>
        )}

        {activeTab === 'profile' && msg && <></>}
        {activeTab === 'profile' && err && <></>}
        </div>
      </div>
    </Layout>
  );
}
