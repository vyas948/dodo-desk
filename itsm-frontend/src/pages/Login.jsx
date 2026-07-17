import PasswordInput from '../components/PasswordInput';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { API } from '../api';
import { useToast } from '../contexts/ToastContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [branding, setBranding] = useState(null); // null = still loading
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const { login, sessionExpiredMessage, clearSessionExpiredMessage } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Show success toast if redirected from password reset
  useEffect(() => {
    if (searchParams.get('reset') === 'success') {
      toast.success('✅ Password reset successfully. You can now log in.');
    }
    if (searchParams.get('email_changed') === '1') {
      toast.success('✅ Email address updated. Please log in with your new email.');
    }
  }, []);
  const { t, language, setLanguage } = useTranslation();
  const { toast } = useToast();

  // If we landed here because the session was invalidated (e.g. logged in
  // elsewhere), surface that reason instead of silently dropping the user
  // back at a blank login form.
  useEffect(() => {
    if (sessionExpiredMessage) {
      toast.error(sessionExpiredMessage);
      clearSessionExpiredMessage();
    }
    // Also check sessionStorage for messages set by apiFetch on hard redirects
    const stored = sessionStorage.getItem('session_expired_message');
    if (stored) {
      toast.error(stored);
      sessionStorage.removeItem('session_expired_message');
    }
  }, [sessionExpiredMessage]);

  useEffect(() => {
    fetch(`${API}/branding/public`)
      .then(r => r.json())
      .then(data => { setBranding(data); setBrandingLoaded(true); })
      .catch(() => { setBranding({ company_name: 'DodoDesk', primary_color: '#059669', logo_url: null }); setBrandingLoaded(true); });
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [ssoInfo, setSsoInfo] = useState(null); // { tenant_slug, login_url, tenant_name }

  const checkSso = async (email) => {
    if (!email || !email.includes('@')) return;
    try {
      const res = await fetch(`${API}/auth/sso/check/${encodeURIComponent(email)}`);
      const data = await res.json();
      setSsoInfo(data.sso_enabled ? data : null);
    } catch { setSsoInfo(null); }
  };
  const [slowWarning, setSlowWarning] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSlowWarning(false);
    // Show "taking longer than usual" message after 5 seconds
    const slowTimer = setTimeout(() => setSlowWarning(true), 5000);
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);
    if (tenantSlug) formData.append('tenant_slug', tenantSlug);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || t('login.invalidCredentials'));
      }
      const data = await res.json();
      if (data.mfa_required) {
        setMfaToken(data.mfa_token);
        return;
      }
      login(data.access_token);
      if (data.mfa_setup_required) {
        toast.error('Your organization requires two-factor authentication. Please set it up now.');
        navigate('/settings');
      } else {
        navigate('/');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      clearTimeout(slowTimer);
      setSubmitting(false);
      setSlowWarning(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    if (!mfaCode) { toast.error('Enter your 6-digit code or a backup code.'); return; }
    setMfaSubmitting(true);
    try {
      const res = await fetch(`${API}/auth/login/mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, code: mfaCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Invalid code.');
      }
      const data = await res.json();
      login(data.access_token);
      navigate('/');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMfaSubmitting(false);
    }
  };

  return (
    <>
      {/* Language toggle */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={() => setLanguage(language === 'en' ? 'fr' : 'en')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-sm text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          <span>{language === 'en' ? '🇫🇷 FR' : '🇬🇧 EN'}</span>
        </button>
      </div>
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 w-full max-w-md">
        <div className="flex flex-col items-center mb-6" style={{ minHeight: 80 }}>
          {brandingLoaded && (
            <>
              {branding?.logo_url ? (
                <img src={branding.logo_url.startsWith('http') ? branding.logo_url : `${API}${branding.logo_url}`}
                     alt="Logo" className="h-16 object-contain mb-3" />
              ) : (
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-sm"
                     style={{ background: branding?.primary_color || '#059669' }}>
                  <svg viewBox="0 0 40 40" className="w-8 h-8" fill="none">
                    <ellipse cx="20" cy="22" rx="13" ry="11" fill="white" fillOpacity="0.95"/>
                    <ellipse cx="20" cy="14" rx="8" ry="7" fill="white" fillOpacity="0.95"/>
                    <circle cx="17.5" cy="13" r="1.5" fill={branding?.primary_color || '#059669'}/>
                    <circle cx="22.5" cy="13" r="1.5" fill={branding?.primary_color || '#059669'}/>
                    <path d="M17 17 Q20 19 23 17" stroke={branding?.primary_color || '#059669'} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                  </svg>
                </div>
              )}
              {branding?.company_name && (
                <h1 className="text-2xl font-bold text-center" style={{color: branding.primary_color}}>
                  {branding.company_name}
                </h1>
              )}
              {branding?.company_tagline && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{branding.company_tagline}</p>
              )}
            </>
          )}
        </div>
        {!mfaToken ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setSsoInfo(null); }}
              onBlur={e => checkSso(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder={t('login.emailPlaceholder')}
            />
            {ssoInfo && (
              <div className="mt-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg">
                <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium mb-2">
                  🔐 {ssoInfo.tenant_name} uses Single Sign-On
                </p>
                <a href={ssoInfo.login_url}
                   className="block w-full text-center bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 rounded-lg transition">
                  Sign in with SSO →
                </a>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.password')}</label>
            <PasswordInput
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder={t('login.passwordPlaceholder')}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg transition font-medium disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Signing in...
              </>
            ) : t('common.login')}
          </button>
          {slowWarning && (
            <p className="text-xs text-center text-gray-400 dark:text-gray-500">
              Taking a moment — please wait...
            </p>
          )}
          <div className="text-center space-y-2">
            <a href="/forgot-password" className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline block">
              Forgot password?
            </a>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Don't have an account?{' '}
              <a href="/signup" className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline">
                Sign up free
              </a>
            </p>
          </div>
        </form>
        ) : (
        <form onSubmit={handleMfaSubmit} className="space-y-4">
          <div className="text-center mb-2">
            <p className="text-2xl mb-1">🔐</p>
            <p className="text-sm font-medium text-gray-800 dark:text-white">Two-Factor Authentication</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Enter the 6-digit code from your authenticator app, or a backup code.</p>
          </div>
          <div>
            <input
              type="text"
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value.trim())}
              required
              autoFocus
              maxLength={11}
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-center text-lg tracking-widest"
              placeholder="000000"
            />
          </div>
          <button
            type="submit"
            disabled={mfaSubmitting}
            className="w-full bg-emerald-600 text-white py-2.5 rounded-lg hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 transition font-medium disabled:opacity-50"
          >
            {mfaSubmitting ? 'Verifying...' : 'Verify'}
          </button>
          <div className="text-center">
            <button type="button" onClick={() => { setMfaToken(null); setMfaCode(''); }} className="text-sm text-gray-500 dark:text-gray-400 hover:underline">
              ← Back to login
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
    </>
  );
}