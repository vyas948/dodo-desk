import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { API } from '../api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [error, setError] = useState('');
  const [branding, setBranding] = useState({ company_name: '', primary_color: '#4f46e5', logo_url: null, company_tagline: null });
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    fetch(`${API}/branding/public`)
      .then(r => r.json())
      .then(data => setBranding(data))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
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
      login(data.access_token);
      navigate('/');
    } catch (err) {
      setError(err.message);
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
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition font-medium"
          >
            {t('common.login')}
          </button>
          <div className="text-center">
            <a href="/forgot-password" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              Forgot password?
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}