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
  const [branding, setBranding] = useState({ company_name: '', primary_color: '#4f46e5', logo_url: null, company_tagline: null });
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Show success toast if redirected from password reset
  useEffect(() => {
    if (searchParams.get('reset') === 'success') {
      toast.success('✅ Password reset successfully. You can now log in.');
    }
  }, []);
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    fetch(`${API}/branding/public`)
      .then(r => r.json())
      .then(data => setBranding(data))
      .catch(() => {});
  }, []);

  const [submitting, setSubmitting] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          {branding.logo_url && (
            <img src={branding.logo_url.startsWith('http') ? branding.logo_url : `${API}${branding.logo_url}`} alt="Logo" className="h-12 object-contain mb-3" />
          )}
          {branding.company_name && (
            <h1 className="text-2xl font-bold text-center" style={{color: branding.primary_color}}>
              {branding.company_name}
            </h1>
          )}
          {branding.company_tagline && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{branding.company_tagline}</p>
          )}
        </div>
        {!mfaToken ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder={t('login.emailPlaceholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder={t('login.passwordPlaceholder')}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition font-medium disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
            <p className="text-xs text-center text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
              ⏳ The server is waking up — this can take up to 30 seconds on first load. Please wait, do not click again.
            </p>
          )}
          <div className="text-center space-y-2">
            <a href="/forgot-password" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline block">
              Forgot password?
            </a>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Don't have an account?{' '}
              <a href="/signup" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
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
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center text-lg tracking-widest"
              placeholder="000000"
            />
          </div>
          <button
            type="submit"
            disabled={mfaSubmitting}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition font-medium disabled:opacity-50"
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
  );
}