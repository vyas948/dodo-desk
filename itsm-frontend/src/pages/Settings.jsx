import PasswordInput from '../components/PasswordInput';
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { useBranding } from '../contexts/BrandingContext';
import { API } from '../api';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import AdminUsersTab from './tabs/AdminUsersTab';
import AgentGroupsTab from './tabs/AgentGroupsTab';
import ApprovalWorkflowsTab from './tabs/ApprovalWorkflowsTab';
import AutomationRulesTab from './tabs/AutomationRulesTab';
import CustomFieldsTab from './tabs/CustomFieldsTab';
import TicketTemplatesTab from './tabs/TicketTemplatesTab';
import MacrosTab from './tabs/MacrosTab';
import BusinessHoursTab from './tabs/BusinessHoursTab';
import EmailTab from './tabs/EmailTab';
import NotificationsTab from './tabs/NotificationsTab';
import AssetModelsTab from './tabs/AssetModelsTab';

const DEPARTMENTS = ['Management','HR','IT','Finance','Operations','Sales & Marketing','Legal','Other Department'];

export default function Settings() {
  const { token, user, setUser } = useAuth();
  const { t, setLanguage } = useTranslation();
  const { toast } = useToast();
  const brandingCtx = useBranding();
  const { refreshBranding } = brandingCtx;
  const [profile, setProfile] = useState({ full_name: '', email: '', language: 'en', theme: 'light', job_title: '', department: '', country: '' });
  const [pendingEmail, setPendingEmail] = useState(null); // new email awaiting confirmation
  const [newEmailInput, setNewEmailInput] = useState('');
  const [showEmailChange, setShowEmailChange] = useState(false);
  const [emailChanging, setEmailChanging] = useState(false);
  const [password, setPassword] = useState({ current: '', new: '', confirm: '' });
  const [photoFile, setPhotoFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Email config state (admin only)
  const [emailCfg, setEmailCfg] = useState({
    smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '',
    smtp_from: 'noreply@itsm.local', reply_to: '',
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
  const [adminAccessList, setAdminAccessList] = useState([]);
  const [adminAccessForm, setAdminAccessForm] = useState({ admin_user_id: '', tenant_id: '' });
  const [allAdmins, setAllAdmins] = useState([]);
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
      country: user.country || '',
    });
    setPendingEmail(user.pending_email || null);

    if (user.profile_photo) {
      // Always go through /users/me/photo which signs the URL server-side
      fetch(`${API}/users/me/photo`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
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
      // All admins use /superadmin/tenants — super_admin sees all, regular admin sees own
      apiFetch('/superadmin/tenants', token)
        .then(data => setTenants(Array.isArray(data) ? data : []))
        .catch(() => {
          // Fallback: fetch own tenant via /admin/tenant if superadmin route fails
          apiFetch('/admin/tenant', token)
            .then(t => setTenants(t ? [t] : []))
            .catch(() => {});
        });
      if (user.role === 'super_admin') fetchAdminAccess();
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
      // Email changes go through the confirmation flow — never save email directly
      const { email: _email, ...profileWithoutEmail } = profile;
      const res = await fetch(`${API}/users/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(profileWithoutEmail),
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

  const handleRequestEmailChange = async () => {
    if (!newEmailInput.trim()) { toast.error('Please enter a new email address.'); return; }
    setEmailChanging(true);
    try {
      const res = await apiFetch('/users/me/request-email-change', token, {
        method: 'POST',
        body: JSON.stringify({ email: newEmailInput.trim().toLowerCase() }),
      });
      toast.success(res.message || `Confirmation sent to ${newEmailInput}`);
      setPendingEmail(newEmailInput.trim().toLowerCase());
      setShowEmailChange(false);
      setNewEmailInput('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setEmailChanging(false);
    }
  };

  const handleCancelEmailChange = async () => {
    try {
      await apiFetch('/users/me/cancel-email-change', token, { method: 'POST' });
      toast.success('Email change cancelled.');
      setPendingEmail(null);
      setShowEmailChange(false);
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
      setPhotoFile(null);
      toast.success('✅ Profile photo updated successfully.');
      // Refresh user context
      const meRes = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
      const updatedUser = await meRes.json();
      setUser(updatedUser);
      // Refresh preview — short delay to allow Cloudinary to process
      setTimeout(() => {
        fetch(`${API}/users/me/photo`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' })
          .then(r => { if (r.ok) return r.blob(); throw new Error(); })
          .then(blob => setPreview(URL.createObjectURL(blob)))
          .catch(() => {});
      }, 1000);
    } catch (e) {
      toast.error(e.message || 'Photo upload failed.');
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
        body: JSON.stringify({ ...emailCfg, reply_to: emailCfg.reply_to || '' }),
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

  const fetchAdminAccess = () => {
    if (user?.role !== 'super_admin') return;
    apiFetch('/superadmin/admin-access', token)
      .then(data => setAdminAccessList(Array.isArray(data) ? data : []))
      .catch(() => {});
    apiFetch('/admin/users?role=admin&limit=200', token)
      .then(data => setAllAdmins(data.items ?? []))
      .catch(() => {});
  };

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
    const planLabels = { free: 'Free', essentials: 'Essentials', business: 'Business', pro: 'Pro', enterprise: 'Enterprise' };
    try {
      await apiFetch(`/superadmin/tenants/${tenant.id}`, token, {
        method: 'PATCH', body: JSON.stringify({ plan: newPlan }),
      });
      toast.success(`${tenant.name} upgraded to ${planLabels[newPlan] || newPlan} plan.`);
      fetchTenants();
    } catch (err) { toast.error(err.message); }
  };

  // Dodo Payments checkout — server creates session, frontend redirects
  const handleUpgrade = async (plan, interval) => {
    setCheckoutLoading(true);
    try {
      const res = await apiFetch('/billing/checkout', token, {
        method: 'POST',
        body: JSON.stringify({ plan: plan || 'essentials', interval: interval || 'month' }),
      });
      if (res.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        toast.error('Could not start checkout. Please try again.');
      }
    } catch (e) {
      toast.error(e.message || 'Checkout failed. Please contact support.');
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

  const planLimits = brandingCtx?.plan_limits || {};
  const isPro = planLimits.mfa === true || user?.role === 'super_admin';  // Business plan and above

  const TABS = [
    { key: 'profile',       label: `👤  ${t('settings.profile') || 'Profile'}` },
    { key: 'billing',       label: `💳  ${t('settings.billing') || 'Billing & Plan'}` },
    ...(isAdmin ? [
      { key: 'customfields',  label: `🗂️  ${t('settings.customFields') || 'Custom Fields'}` },
      { key: 'templates',     label: `📋  ${t('settings.ticketTemplates') || 'Ticket Templates'}` },
      { key: 'macros',        label: `⚡  ${t('settings.macros') || 'Macros'}` },
      { key: 'assetmodels',   label: `💻  ${t('settings.assetModels') || 'Asset Models'}` },
      { key: 'sla',           label: `⏱️  ${t('settings.sla') || 'SLA & Escalation'}` },
      { key: 'businesshours', label: `🕐  ${t('settings.businessHours') || 'Business Hours'}` },
      { key: 'automation',    label: `🤖  ${t('settings.automationRules') || 'Automation Rules'}` },
      { key: 'email',         label: `📧  ${t('settings.emailIntegrations') || 'Email & Integrations'}` },
      { key: 'notifications', label: `🔔  ${t('settings.notifications') || 'Notifications'}` },
      { key: 'security',      label: `🔐  ${t('settings.security') || 'Security'}` },
      { key: 'groups',        label: `🫂  ${t('settings.agentGroups') || 'Agent Groups'}` },
      { key: 'workflows',     label: `✅  ${t('settings.approvalWorkflows') || 'Approval Workflows'}` },
      { key: 'tenants',       label: `🏬  ${t('settings.organisations') || 'Organisations'}` },
    ] : []),
  ];

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'profile');

  // Handle return from Dodo Payments hosted checkout — runs ONCE on mount only
  useEffect(() => {
    if (searchParams.get('billing') === 'success') {
      // Clean the URL immediately so re-renders don't re-trigger
      window.history.replaceState({}, '', '/settings?tab=billing');
      toast.success('🎉 Payment successful! Your plan is being updated.');
      setActiveTab('billing');
      // Refresh billing config to reflect new plan
      apiFetch('/billing/config', token).then(setBillingConfig).catch(() => {});
    }
    // Legacy: auto-trigger Dodo checkout if redirected here after signup
    if (searchParams.get('upgrade') === '1') {
      window.history.replaceState({}, '', '/settings?tab=billing');
      handleUpgrade(billingConfig?.selected_plan || 'essentials', 'month');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally runs once on mount

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('common.settings')}</h1>

        <div className="flex gap-6 items-start">
          {/* Vertical tab nav */}
          <nav className="w-56 flex-shrink-0 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-2 space-y-0.5 sticky top-4">
            {TABS.map(tab => {
              const locked = false; // super_admin always has access
              return (
                <button key={tab.key} onClick={() => !locked && setActiveTab(tab.key)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
                          activeTab === tab.key
                            ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                            : locked
                              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                        }`}>
                  {locked && <span className="text-xs">🔒</span>}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-6">
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
            {/* Current email — read only, change via confirmation flow */}
            <div className="flex items-center gap-2">
              <input type="email" value={profile.email} readOnly
                     className={`${inputClass} bg-gray-50 dark:bg-gray-800 cursor-not-allowed opacity-70 flex-1`} />
              <button type="button" onClick={() => setShowEmailChange(!showEmailChange)}
                      className="text-xs text-indigo-600 hover:underline whitespace-nowrap">
                Change
              </button>
            </div>

            {/* Pending confirmation notice */}
            {pendingEmail && !showEmailChange && (
              <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
                  ⏳ Awaiting confirmation for: <strong>{pendingEmail}</strong>
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Check your new inbox and click the confirmation link. Your current email stays active until confirmed.
                </p>
                <button type="button" onClick={handleCancelEmailChange}
                        className="text-xs text-red-500 hover:underline mt-1">
                  Cancel email change
                </button>
              </div>
            )}

            {/* Email change form */}
            {showEmailChange && (
              <div className="mt-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg space-y-2">
                <p className="text-xs text-indigo-600 dark:text-indigo-400">
                  A confirmation link will be sent to your new email. Your current email stays active until you confirm.
                </p>
                <input type="email" value={newEmailInput} placeholder="New email address"
                       onChange={e => setNewEmailInput(e.target.value)}
                       className={inputClass} />
                <div className="flex gap-2">
                  <button type="button" onClick={handleRequestEmailChange} disabled={emailChanging}
                          className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
                    {emailChanging ? 'Sending...' : 'Send confirmation'}
                  </button>
                  <button type="button" onClick={() => { setShowEmailChange(false); setNewEmailInput(''); }}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
            <label className={labelClass}>Phone Number</label>
            <input
              type="tel"
              value={profile.phone || ''}
              onChange={e => setProfile({ ...profile, phone: e.target.value })}
              placeholder="+1 555 000 0000"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Timezone</label>
            <select value={profile.timezone || 'UTC'} onChange={e => setProfile({ ...profile, timezone: e.target.value })} className={inputClass}>
              {['UTC','Africa/Nairobi','America/Chicago','America/Los_Angeles','America/New_York','America/Sao_Paulo','Asia/Colombo','Asia/Dubai','Asia/Hong_Kong','Asia/Karachi','Asia/Kolkata','Asia/Kuala_Lumpur','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Tokyo','Australia/Melbourne','Australia/Sydney','Europe/Amsterdam','Europe/Berlin','Europe/London','Europe/Madrid','Europe/Moscow','Europe/Paris','Indian/Mauritius','Pacific/Auckland'].map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
          {['agent','admin','super_admin'].includes(user?.role) && (
            <div>
              <label className={labelClass}>Availability Status</label>
              <div className="flex gap-2 flex-wrap">
                {[['online','🟢 Online'],['busy','🟡 Busy'],['away','🟠 Away'],['offline','⚫ Offline']].map(([val, label]) => (
                  <button key={val} type="button"
                          onClick={() => setProfile({ ...profile, availability: val })}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${(profile.availability||'online') === val ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-400'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className={labelClass}>Department</label>
            <select value={profile.department || ''} onChange={e => setProfile({ ...profile, department: e.target.value })} className={inputClass}>
              <option value="">— Select Department —</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Country</label>
            <select value={profile.country || ''} onChange={e => setProfile({ ...profile, country: e.target.value })} className={inputClass}>
              <option value="">— Select Country —</option>
              {["Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Belarus","Belgium","Belize","Benin","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominican Republic","Ecuador","Egypt","El Salvador","Estonia","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Guatemala","Guinea","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Mauritania","Mauritius","Mexico","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saudi Arabia","Senegal","Serbia","Sierra Leone","Singapore","Slovakia","Slovenia","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Togo","Tunisia","Turkey","Turkmenistan","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
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
            <PasswordInput
              value={password.current}
              onChange={e => setPassword({ ...password, current: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('settings.newPassword')}</label>
            <PasswordInput
              value={password.new}
              onChange={e => setPassword({ ...password, new: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('settings.confirmPassword')}</label>
            <PasswordInput
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

        {/* Upgrade prompt for locked tabs */}
        {((activeTab === 'sla' || activeTab === 'security') && !isPro && isAdmin) && (
          <div className={cardClass + " text-center py-10"}>
            <div className="text-4xl mb-3">🔒</div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">
              {activeTab === 'sla' ? (t('settings.sla') || 'SLA & Escalation') : (t('settings.security') || 'Security')} — Pro
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">
              {activeTab === 'sla'
                ? (t('settings.slaProDesc') || 'Set SLA targets, escalation rules, and business hours to ensure tickets are resolved on time.')
                : (t('settings.securityProDesc') || 'Enable MFA, SSO, and advanced security policies to protect your organisation.')}
            </p>
            <button onClick={() => handleUpgrade(billingInterval === 'year' ? 'essentials' : 'essentials', billingInterval || 'month')}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-semibold transition">
              ↑ {t('settings.upgradeToPro') || 'Upgrade to Pro'} — $59/mo
            </button>
            <p className="text-xs text-gray-400 mt-3">14-day money-back guarantee · Cancel anytime</p>
          </div>
        )}

        {/* Escalation Rules — admin only */}
        {activeTab === 'sla' && isPro && (user?.role === 'admin' || user?.role === 'super_admin') && (
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">🔺 {t('settings.escalationRules') || 'Escalation Rules'}</h2>
              <button onClick={() => setShowEscalationForm(true)}
                      className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition">
                + {t('settings.addRule') || 'Add Rule'}
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('settings.escalationDesc') || 'Automatically reassign tickets that have been idle for too long.'}
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
                          className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm">{t('common.cancel') || 'Cancel'}</button>
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
        {activeTab === 'sla' && isPro && (user?.role === 'admin' || user?.role === 'super_admin') && (
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">🕘 {t('settings.businessHours') || 'Business Hours'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('settings.businessHoursDesc') || 'When enabled, SLA timers only count during business hours and skip weekends.'}</p>

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
              {bizSaving ? t('common.loading') || 'Saving...' : t('settings.saveBusinessHours') || 'Save Business Hours'}
            </button>
            
            
          </div>
        )}

        {/* SLA Configuration — admin only */}
        {activeTab === 'sla' && isPro && (user?.role === 'admin' || user?.role === 'super_admin') && (
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">⏱ {t('settings.slaConfiguration') || 'SLA Configuration'}</h2>
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
              {slaSaving ? t('common.loading') || 'Saving...' : t('settings.saveSla') || 'Save SLA Configuration'}
            </button>
            
            
          </div>
        )}

        {/* Email & Webhook Configuration — admin only */}



        {/* Personal MFA Enrollment — Business plan and above */}
        {activeTab === 'security' && planLimits.mfa && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">🔐 {t('settings.mfaTitle') || 'Two-Factor Authentication (MFA)'}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            {t('settings.mfaProfileDesc') || 'Add an extra layer of security to your account using an authenticator app (Google Authenticator, Authy, etc.)'}
          </p>

          {mfaStatus.mfa_enabled && !mfaBackupCodes && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-medium">
                ✅ {t('settings.mfaActive') || 'MFA is enabled on your account'}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('settings.backupCodesRemaining') || 'Backup codes remaining:'} {mfaStatus.backup_codes_remaining}
              </p>
              <div className="pt-2">
                <label className={labelClass}>{t('settings.mfaDisableLabel') || 'Enter your password to disable MFA'}</label>
                <PasswordInput value={mfaDisablePassword} onChange={e => setMfaDisablePassword(e.target.value)} className={inputClass} placeholder={t('settings.currentPassword') || 'Current password'} />
                <button onClick={handleMfaDisable} disabled={mfaLoading} className="mt-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition disabled:opacity-50">
                  {t('settings.mfaDisableBtn') || 'Disable MFA'}
                </button>
              </div>
            </div>
          )}

          {!mfaStatus.mfa_enabled && !mfaSetup && !mfaBackupCodes && (
            brandingCtx.plan_limits && !brandingCtx.plan_limits?.mfa ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                🔒 Two-factor authentication is available on the <strong>Pro</strong> plan and above.
              </div>
            ) : (
              <button onClick={handleMfaSetupStart} disabled={mfaLoading} className={btnClass}>
                {mfaLoading ? t('common.loading') || 'Loading...' : t('settings.mfaSetupBtn') || 'Set Up MFA'}
              </button>
            )
          )}

          {mfaSetup && (
            <div className="space-y-3 border border-indigo-200 dark:border-indigo-700 rounded-lg p-4 bg-indigo-50 dark:bg-indigo-900/30">
              <p className="text-sm font-medium text-gray-800 dark:text-white">{t('settings.mfaStep1') || 'Step 1 — Add this account to your authenticator app'}</p>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('settings.mfaStep1Desc') || 'In Google Authenticator or Authy, choose'} <strong>"Enter a setup key"</strong> (manual entry) and use:</p>
                <div className="grid grid-cols-[80px_1fr] gap-1 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Account:</span>
                  <span className="font-mono">{user?.email}</span>
                  <span className="text-gray-500 dark:text-gray-400">Key:</span>
                  <span className="font-mono font-semibold tracking-wider break-all">{mfaSetup.secret}</span>
                  <span className="text-gray-500 dark:text-gray-400">Type:</span>
                  <span className="font-mono">Time based</span>
                </div>
              </div>
              {/* QR Code — generated server-side, no external API */}
              <div className="flex flex-col items-center gap-2">
                {mfaSetup.qr_data_url ? (
                  <div className="bg-white p-3 rounded-lg inline-block border border-gray-200 dark:border-gray-600">
                    <img src={mfaSetup.qr_data_url} alt="MFA QR Code" width={200} height={200} />
                  </div>
                ) : (
                  <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 text-sm text-gray-500 dark:text-gray-400 text-center w-[200px] h-[200px] flex items-center justify-center">
                    QR not available — use the setup key below
                  </div>
                )}
                <p className="text-xs text-gray-400">Scan with Google Authenticator or Authy</p>
              </div>
              <p className="text-sm font-medium text-gray-800 dark:text-white pt-2">{t('settings.mfaStep2') || 'Step 2 — Enter the 6-digit code from your authenticator app'}</p>
              <input type="text" value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                     placeholder="000000" maxLength={6} className={`${inputClass} font-mono text-lg tracking-widest text-center w-32`} />
              <div className="flex gap-2">
                <button onClick={handleMfaConfirm} disabled={mfaLoading} className={btnClass}>
                  {mfaLoading ? t('common.loading') || 'Verifying...' : t('settings.mfaConfirmBtn') || 'Confirm & Enable MFA'}
                </button>
                <button onClick={() => { setMfaSetup(null); setMfaCode(''); }} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mfaBackupCodes && (
            <div className="space-y-3 border border-green-200 dark:border-green-700 rounded-lg p-4 bg-green-50 dark:bg-green-900/30">
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">{t('settings.mfaEnabledTitle') || '✅ MFA Enabled! Save your backup codes'}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {t('settings.mfaBackupDesc') || 'If you lose access to your authenticator app, use one of these one-time codes to log in. Each code can only be used once. Store them somewhere safe.'}
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {mfaBackupCodes.map(code => (
                  <div key={code} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-center">{code}</div>
                ))}
              </div>
              <button onClick={() => setMfaBackupCodes(null)} className={btnClass}>
                {t('settings.mfaSavedBtn') || "I've Saved My Backup Codes"}
              </button>
            </div>
          )}
        </div>
        )}
        {activeTab === 'security' && !planLimits.mfa && user?.role !== 'super_admin' && (
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white">🔐 Two-Factor Authentication (MFA)</h2>
            <div className="mt-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">🔒 MFA is available on the Business plan and above</p>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">Upgrade to enable two-factor authentication for your account.</p>
              <button onClick={() => setActiveTab('billing')} className="mt-2 text-xs text-indigo-600 hover:underline font-medium">Upgrade plan →</button>
            </div>
          </div>
        )}
        {activeTab === 'security' && isPro && (user?.role === 'admin' || user?.role === 'super_admin') && (
          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1">🔑 {t('settings.mfaTitle') || 'Multi-Factor Authentication (MFA)'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('settings.mfaDesc') || 'TOTP-based MFA (Google Authenticator, Authy). When enabled, users can enroll from their profile.'}</p>
            <div className="space-y-3 mb-6">
              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <input type="checkbox" checked={secCfg.mfa_enabled}
                       onChange={e => setSecCfg({...secCfg, mfa_enabled: e.target.checked, mfa_required: e.target.checked ? secCfg.mfa_required : false})}
                       className="w-4 h-4 rounded text-indigo-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white">{t('settings.enableMfa') || 'Enable MFA'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.mfaVoluntaryDesc') || 'Allow users to voluntarily enroll in MFA'}</p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${secCfg.mfa_enabled ? 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50' : 'border-gray-100 dark:border-gray-800 opacity-40 pointer-events-none'}`}>
                <input type="checkbox" checked={secCfg.mfa_required} disabled={!secCfg.mfa_enabled}
                       onChange={e => setSecCfg({...secCfg, mfa_required: e.target.checked})}
                       className="w-4 h-4 rounded text-indigo-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white">{t('settings.requireMfa') || 'Require MFA for all users'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.mfaRequiredDesc') || 'Users must set up MFA before accessing the portal'}</p>
                </div>
              </label>
            </div>
            <hr className="border-gray-200 dark:border-gray-700 my-5" />
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1">🔗 {t('settings.ssoTitle') || 'Single Sign-On (SSO)'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('settings.ssoDesc') || 'Allow users to log in with their corporate identity provider.'}</p>
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 mb-4">
              <input type="checkbox" checked={secCfg.sso_enabled}
                     onChange={e => setSecCfg({...secCfg, sso_enabled: e.target.checked})}
                     className="w-4 h-4 rounded text-indigo-600" />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-white">{t('settings.enableSso') || 'Enable SSO'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.ssoLoginLabel') || 'Show Sign in with SSO on the login page'}</p>
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
                    <PasswordInput value={secCfg.sso_client_secret} onChange={e => setSecCfg({...secCfg, sso_client_secret: e.target.value})}
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
                {secSaving ? t('common.loading') || 'Saving...' : t('settings.saveSecuritySettings') || 'Save Security Settings'}
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
                  {user?.role === 'super_admin' ? t('settings.tenantsDesc') || 'Manage client organisations on DodoDesk.' : 'Your organisation on DodoDesk.'}
                </p>
              </div>
              {user?.role === 'super_admin' && (
                <button onClick={() => { setShowTenantForm(true); setEditingTenantId(null); setTenantForm(EMPTY_TENANT); }}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
                  {t('settings.newTenant') || 'New Tenant'}
                </button>
              )}
            </div>

            {showTenantForm && (
              <form onSubmit={handleTenantSave} className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600 space-y-4">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{editingTenantId ? 'Edit Tenant' : t('settings.newTenant') || 'New Tenant'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{t('settings.companyName') || 'Company Name'} *</label>
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
                    <label className={labelClass}>{t('settings.supportEmail') || 'Support Email'}</label>
                    <input type="email" value={tenantForm.support_email}
                           onChange={e => setTenantForm({ ...tenantForm, support_email: e.target.value })}
                           placeholder="support@client.com" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>{t('settings.companyTagline') || 'Company Tagline'}</label>
                    <input type="text" value={tenantForm.company_tagline}
                           onChange={e => setTenantForm({ ...tenantForm, company_tagline: e.target.value })}
                           placeholder="e.g. Powering your IT operations" className={inputClass} />
                  </div>
                </div>
                {!editingTenantId && (
                  <>
                    <hr className="border-gray-200 dark:border-gray-600" />
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t('settings.adminUser') || 'Admin User'}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>{t('settings.adminName') || 'Admin Name'}</label>
                        <input type="text" value={tenantForm.admin_name}
                               onChange={e => setTenantForm({ ...tenantForm, admin_name: e.target.value })}
                               placeholder="John Smith" className={inputClass} />
                      </div>
                      <div>
                        <label className={labelClass}>{t('settings.adminEmail') || 'Admin Email'}</label>
                        <input type="email" value={tenantForm.admin_email}
                               onChange={e => setTenantForm({ ...tenantForm, admin_email: e.target.value })}
                               placeholder="admin@client.com" className={inputClass} />
                      </div>
                      <div>
                        <label className={labelClass}>{t('settings.adminPassword') || 'Admin Password'}</label>
                        <PasswordInput value={tenantForm.admin_password}
                               onChange={e => setTenantForm({ ...tenantForm, admin_password: e.target.value })}
                               placeholder="Min 8 characters" className={inputClass} />
                      </div>
                    </div>
                  </>
                )}
                {/* Branding — shown for both create and edit */}
                <hr className="border-gray-200 dark:border-gray-600" />
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{('🎨 ' + (t('settings.branding') || 'Branding'))}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{t('settings.primaryColor') || 'Primary Color'}</label>
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
                    <label className={labelClass}>{t('settings.accentColor') || 'Accent Color'}</label>
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
                  {user?.role === 'super_admin' ? t('settings.noTenants') || 'No tenants yet. Click New Tenant to add your first client.' : 'No tenant information available.'}
                </p>
              )}
              {tenants.map(tenant => (
                <div key={tenant.id} className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: tenant.primary_color }} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white">{tenant.name}</p>
                        <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{tenant.slug}</span>
                        {tenant.is_own && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                            Your account
                          </span>
                        )}
                        {tenant.is_granted && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                            Client account
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tenant.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-gray-100 text-gray-500'}`}>
                          {tenant.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          tenant.plan === 'enterprise' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                          : tenant.plan === 'pro' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                          : tenant.plan === 'business' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300'
                          : tenant.plan === 'essentials' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {tenant.plan === 'enterprise' ? 'Enterprise'
                           : tenant.plan === 'pro' ? 'Pro'
                           : tenant.plan === 'business' ? 'Business'
                           : tenant.plan === 'essentials' ? 'Essentials'
                           : 'Free'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {tenant.user_count} users · {tenant.support_email && `${tenant.support_email} · `}joined {tenant.created_at || ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-center">
                    {user?.role === 'super_admin' ? (
                      <select value={tenant.plan || 'free'} onChange={e => handlePlanChange(tenant, e.target.value)}
                              title="Change plan"
                              className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                        <option value="free">Free (1 agent)</option>
                        <option value="essentials">Essentials – $15/agent/mo</option>
                        <option value="business">Business – $35/agent/mo</option>
                        <option value="pro">Pro – $65/agent/mo</option>
                        <option value="enterprise">Enterprise – Custom</option>
                      </select>
                    ) : tenant.is_own && (
                      <button
                        onClick={() => { setActiveTab('billing'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition font-medium">
                        Upgrade plan →
                      </button>
                    )}
                    <button onClick={() => {
                                setTenantForm({ ...EMPTY_TENANT, name: tenant.name, support_email: tenant.support_email || '', company_tagline: tenant.company_tagline || '', primary_color: tenant.primary_color || '#4f46e5', accent_color: tenant.accent_color || '#818cf8', logo_url: tenant.logo_url || '' });
                                setEditingTenantId(tenant.id);
                                setShowTenantForm(true);
                                toast.success(`Editing ${tenant.name} — scroll up to the form`);
                                setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
                              }}
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
                    {user?.role === 'super_admin' && (
                      <button
                        onClick={() => {
                          const url = `${API}/superadmin/tenants/${tenant.id}/export`;
                          fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                            .then(r => {
                              if (!r.ok) throw new Error('Export failed');
                              return r.blob();
                            })
                            .then(blob => {
                              const a = document.createElement('a');
                              a.href = URL.createObjectURL(blob);
                              a.download = `dodesk_export_${tenant.slug}.xlsx`;
                              a.click();
                              URL.revokeObjectURL(a.href);
                              toast.success(`Data exported for "${tenant.name}"`);
                            })
                            .catch(err => toast.error(err.message));
                        }}
                        title="Export all tenant data"
                        className="text-green-500 hover:text-green-700 dark:hover:text-green-400 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    )}
                    {user?.role === 'super_admin' && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Permanently delete "${tenant.name}" and ALL its data? This cannot be undone.`)) {
                            apiFetch(`/superadmin/tenants/${tenant.id}`, token, { method: 'DELETE' })
                              .then(() => { toast.success(`Tenant "${tenant.name}" deleted.`); fetchTenants(); })
                              .catch(err => toast.error(err.message));
                          }
                        }}
                        title="Delete tenant permanently"
                        className="text-red-400 hover:text-red-600 dark:hover:text-red-400 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Admin Multi-Tenant Access (super admin only) ── */}
            {user?.role === 'super_admin' && (
              <div className={`${cardClass} mt-6`}>
                <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">Admin Cross-Tenant Access</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Grant an Admin access to manage tickets and users across multiple tenants. Only super admins can configure this.
                </p>

                {/* Grant access form */}
                <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <select
                    value={adminAccessForm.admin_user_id}
                    onChange={e => setAdminAccessForm(f => ({ ...f, admin_user_id: e.target.value }))}
                    className="flex-1 min-w-[180px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">Select Admin...</option>
                    {allAdmins.map(a => <option key={a.id} value={a.id}>{a.full_name} ({a.email})</option>)}
                  </select>
                  <select
                    value={adminAccessForm.tenant_id}
                    onChange={e => setAdminAccessForm(f => ({ ...f, tenant_id: e.target.value }))}
                    className="flex-1 min-w-[180px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">Select Tenant...</option>
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button
                    disabled={!adminAccessForm.admin_user_id || !adminAccessForm.tenant_id}
                    onClick={async () => {
                      try {
                        await apiFetch('/superadmin/admin-access', token, {
                          method: 'POST',
                          body: JSON.stringify({
                            admin_user_id: parseInt(adminAccessForm.admin_user_id),
                            tenant_id: parseInt(adminAccessForm.tenant_id),
                          }),
                        });
                        toast.success('Access granted');
                        setAdminAccessForm({ admin_user_id: '', tenant_id: '' });
                        fetchAdminAccess();
                      } catch(err) { toast.error(err.message); }
                    }}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    Grant Access
                  </button>
                </div>

                {/* Current access list */}
                {adminAccessList.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No cross-tenant access configured yet.</p>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    {adminAccessList.map(a => (
                      <div key={a.id} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-white">{a.admin_name}</p>
                          <p className="text-xs text-gray-400">{a.admin_email} → <span className="font-medium text-indigo-500">{a.tenant_name}</span></p>
                        </div>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Revoke ${a.admin_name}'s access to ${a.tenant_name}?`)) return;
                            await apiFetch(`/superadmin/admin-access/${a.id}`, token, { method: 'DELETE' });
                            toast.success('Access revoked');
                            fetchAdminAccess();
                          }}
                          className="text-red-400 hover:text-red-600 transition"
                          title="Revoke access"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* ── Billing & Plan tab ── */}
        {activeTab === 'billing' && user?.role === 'admin' && (
          <div className={cardClass}>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-4">💳 Billing & Plan</h3>

            {/* Current plan status */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                brandingCtx.plan === 'enterprise' ? 'bg-purple-100 text-purple-700'
                : brandingCtx.plan === 'pro' ? 'bg-indigo-100 text-indigo-700'
                : brandingCtx.plan === 'business' ? 'bg-sky-100 text-sky-700'
                : brandingCtx.plan === 'essentials' ? 'bg-teal-100 text-teal-700'
                : 'bg-gray-100 text-gray-600'
              }`}>
                {brandingCtx.plan_limits?.label || 'Free'} Plan
              </span>
              {billingConfig?.on_trial && !billingConfig?.trial_expired && (
                <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-100 text-blue-700">
                  ⏳ Trial: {billingConfig.trial_days_remaining} day{billingConfig.trial_days_remaining === 1 ? '' : 's'} remaining
                </span>
              )}
              {billingConfig?.trial_expired && (
                <span className="text-xs font-medium px-3 py-1 rounded-full bg-red-100 text-red-700">⛔ Trial ended</span>
              )}
              {billingConfig?.billing_status === 'active' && (
                <span className="text-xs font-medium px-3 py-1 rounded-full bg-green-100 text-green-700">✅ Active subscription</span>
              )}
            </div>

            {/* Trial expiry warning */}
            {billingConfig?.trial_expired && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                ⛔ Your {billingConfig?.trial_plan_label || ''} trial has ended. Subscribe below to restore full access.
              </div>
            )}
            {billingConfig?.billing_status === 'past_due' && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                ⚠️ Your last payment failed. Please update your payment method via Manage Billing below.
              </div>
            )}

            {/* Plan picker — only show if not enterprise */}
            {brandingCtx.plan !== 'enterprise' && billingConfig?.billing_status !== 'active' && (
              <div className="mb-6">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Choose your plan:</p>

                {/* Billing toggle */}
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1 text-xs mb-4 w-fit">
                  <button onClick={() => setBillingInterval('month')}
                          className={`px-4 py-1.5 rounded-md transition ${billingInterval === 'month' ? 'bg-white dark:bg-gray-600 shadow text-gray-800 dark:text-white font-medium' : 'text-gray-500'}`}>
                    Monthly
                  </button>
                  <button onClick={() => setBillingInterval('year')}
                          className={`px-4 py-1.5 rounded-md transition ${billingInterval === 'year' ? 'bg-white dark:bg-gray-600 shadow text-gray-800 dark:text-white font-medium' : 'text-gray-500'}`}>
                    Annual <span className="text-green-600 font-semibold">15% off</span>
                  </button>
                </div>

                {/* Plan cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { key: 'essentials', label: 'Essentials', monthly: 15, annual: 153, color: 'teal', features: ['Service Catalog', '250 assets', 'Basic SLA'] },
                    { key: 'business',   label: 'Business',   monthly: 35, annual: 357, color: 'sky',  features: ['1,000 assets', 'Automation', 'Audit Log'] },
                    { key: 'pro',        label: 'Pro',   monthly: 65, annual: 663, color: 'indigo',features: ['5,000 assets', 'Change Mgmt', 'AI Chatbot'] },
                  ].map(p => {
                    const isCurrent = brandingCtx.plan === p.key;
                    return (
                      <div key={p.key} className={`border-2 rounded-xl p-4 ${isCurrent ? `border-${p.color}-500 bg-${p.color}-50 dark:bg-${p.color}-900/20` : 'border-gray-200 dark:border-gray-700'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-gray-900 dark:text-white">{p.label}</span>
                          {isCurrent && <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">Current</span>}
                        </div>
                        <div className="mb-2">
                          <span className="text-2xl font-extrabold text-gray-900 dark:text-white">
                            ${billingInterval === 'year' ? p.annual : p.monthly}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {billingInterval === 'year' ? '/agent/yr' : '/agent/mo'}
                          </span>
                        </div>
                        <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5 mb-3">
                          {p.features.map(f => <li key={f}>✓ {f}</li>)}
                        </ul>
                        <button
                          onClick={() => handleUpgrade(p.key, billingInterval)}
                          disabled={checkoutLoading}
                          className={`w-full py-2 rounded-lg text-xs font-semibold transition disabled:opacity-50 ${
                            isCurrent
                              ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 cursor-default'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}>
                          {checkoutLoading ? 'Loading...' : isCurrent ? 'Current plan' : `Subscribe to ${p.label}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Need more? <a href="mailto:contact@dodobay.com" className="text-indigo-600 hover:underline">Contact us for Enterprise.</a>
                </p>
              </div>
            )}

            {/* Active subscription — manage billing */}
            {/* Manage billing — show for active subscriptions */}
            {billingConfig?.billing_status === 'active' && (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Active subscription</p>
                    {billingConfig?.plan_renews_at && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Renews on {new Date(billingConfig.plan_renews_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button onClick={handleManageBilling} disabled={portalLoading}
                          className="text-sm text-indigo-600 hover:underline disabled:opacity-50">
                    {portalLoading ? 'Opening...' : '⚙️ Manage billing & subscription'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  To cancel your subscription, click "Manage billing" → Cancel subscription in the Dodo Payments portal.
                  Your access continues until the end of the current billing period.
                </p>
              </div>
            )}

            {/* Cancel trial option */}
            {billingConfig?.on_trial && !billingConfig?.trial_expired && (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Trial period — no payment taken yet
                </p>
                <p className="text-xs text-gray-400 mb-2">
                  Your trial ends in {billingConfig.trial_days_remaining} day{billingConfig.trial_days_remaining === 1 ? '' : 's'}.
                  If you don't subscribe before then, your account automatically moves to the Free plan.
                  No action needed to cancel — simply don't subscribe.
                </p>
                <p className="text-xs text-gray-400">
                  Want to cancel immediately? Email <a href="mailto:contact@dodobay.com" className="text-indigo-600 hover:underline">contact@dodobay.com</a>
                </p>
              </div>
            )}

            {/* Cancelled state */}
            {billingConfig?.billing_status === 'cancelled' && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">Subscription cancelled</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Your account is on the Free plan. Subscribe above to restore full access.
                </p>
              </div>
            )}
          </div>
        )}


        {/* ── Users & Roles tab ── */}
        {activeTab === 'users' && isAdmin && <AdminUsersTab />}

        {/* ── Agent Groups tab ── */}
        {activeTab === 'groups' && isAdmin && <AgentGroupsTab />}

        {/* ── Approval Workflows tab ── */}
        {activeTab === 'workflows' && isAdmin && <ApprovalWorkflowsTab />}

        {/* ── Automation Rules tab ── */}
        {activeTab === 'automation' && isAdmin && <AutomationRulesTab />}
        {activeTab === 'customfields' && isAdmin && <CustomFieldsTab />}
        {activeTab === 'templates' && isAdmin && <TicketTemplatesTab />}
        {activeTab === 'macros' && isAdmin && <MacrosTab />}
        {activeTab === 'businesshours' && isAdmin && <BusinessHoursTab />}
        {activeTab === 'email' && isAdmin && <EmailTab />}
        {activeTab === 'assetmodels' && isAdmin && <AssetModelsTab />}
        {activeTab === 'notifications' && <NotificationsTab />}


          </div>{/* end main content */}
        </div>{/* end flex */}
      </div>
    </Layout>
  );
}
