import PasswordInput from '../components/PasswordInput';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { apiFetch } from '../apiFetch';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from '../i18n/I18nContext';
import { API } from '../api';

const FIELD = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
const LABEL = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

export default function Signup() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const initialPlan = searchParams.get('plan') === 'pro' ? 'pro' : 'free';

  const [plan, setPlan] = useState(initialPlan);
  const [form, setForm] = useState({ company_name: '', full_name: '', email: '', password: '', confirm_password: '' });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [branding, setBranding] = useState({ logo_url: null, company_name: 'DodoDesk', primary_color: '#4f46e5' });
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API}/branding/public`)
      .then(r => r.json())
      .then(d => { setBranding(d); setBrandingLoaded(true); })
      .catch(() => { setBrandingLoaded(true); });
  }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm_password) { toast.error(t('errors.passwordMismatch') || 'Passwords do not match.'); return; }
    if (form.password.length < 8) { toast.error(t('errors.passwordMinLength') || 'Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      await apiFetch('/auth/signup', null, {
        method: 'POST',
        body: JSON.stringify({ company_name: form.company_name, full_name: form.full_name, email: form.email, password: form.password, plan }),
      });
      setDone(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Check your email</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            We've sent a verification link to <strong>{form.email}</strong>. Click the link to activate your account.
            {plan === 'pro' && " After verifying, you'll be taken straight to checkout to start your Pro subscription."}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Didn't receive it?{' '}
            <button onClick={async () => {
              try {
                await apiFetch('/auth/resend-verification', null, { method: 'POST', body: JSON.stringify({ email: form.email }) });
                alert('A new verification link has been sent.');
              } catch { alert('Could not resend. Please try again in a moment.'); }
            }} className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Resend verification email
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          {/* Logo — wait for branding to load before rendering to prevent flash */}
          {!brandingLoaded ? (
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
              <div className="h-7 w-32 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          ) : branding.logo_url ? (
            <div className="flex flex-col items-center gap-2 mb-4">
              <img src={branding.logo_url} alt={branding.company_name}
                   className="h-14 w-auto object-contain" />
              <span className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                {branding.company_name || 'DodoDesk'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                   style={{ backgroundColor: branding.primary_color || '#4f46e5' }}>
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <span className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                {branding.company_name || 'DodoDesk'}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create your account</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Set up your IT helpdesk in minutes</p>
        </div>

        {/* Plan selector */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Choose your plan</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setPlan('free')}
              className={`rounded-xl border-2 p-3 text-left transition ${plan === 'free' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-800 dark:text-white">{t('signup.freeTrial') || 'Free Trial'}</span>
                {plan === 'free' && <span className="w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                </span>}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">$0 · 14 days · 1 agent</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('signup.coreTicketing') || 'Core ticketing included'}</p>
            </button>
            <button type="button" onClick={() => setPlan('pro')}
              className={`rounded-xl border-2 p-3 text-left transition relative ${plan === 'pro' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
              <div className="absolute -top-2 right-3">
                <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full font-medium">{t('signup.popular') || 'Popular'}</span>
              </div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-800 dark:text-white">Pro</span>
                {plan === 'pro' && <span className="w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                </span>}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">$59/mo · 2–5 agents</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('signup.allFeatures') || 'All features included'}</p>
            </button>
          </div>
          {plan === 'pro' && (
            <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-2 text-center">
              You'll be taken to checkout after verifying your email.
            </p>
          )}
          <p className="text-xs text-center text-gray-400 dark:text-gray-500 mt-2">
            {t('signup.needMoreAgents') || 'Need 6+ agents?'}{' '}
            <a href="mailto:sales@dododesk.com" className="text-indigo-600 dark:text-indigo-400 hover:underline">{t('signup.contactEnterprise') || 'Contact us for Enterprise'}</a>
          </p>
        </div>

        {/* Form */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={LABEL}>{t('signup.companyName') || 'Company name'}</label>
              <input type="text" required value={form.company_name} onChange={e => update('company_name', e.target.value)}
                className={FIELD} placeholder="Acme Corp" autoFocus />
            </div>
            <div>
              <label className={LABEL}>{t('signup.fullName') || 'Your full name'}</label>
              <input type="text" required value={form.full_name} onChange={e => update('full_name', e.target.value)}
                className={FIELD} placeholder="Jane Doe" />
            </div>
            <div>
              <label className={LABEL}>{t('signup.workEmail') || 'Work email'}</label>
              <input type="email" required value={form.email} onChange={e => update('email', e.target.value)}
                className={FIELD} placeholder="jane@acmecorp.com" />
            </div>
            <div>
              <label className={LABEL}>{t('common.password') || 'Password'}</label>
              <PasswordInput required value={form.password} onChange={e => update('password', e.target.value)}
                className={FIELD} placeholder="Min. 8 characters" />
            </div>
            <div>
              <label className={LABEL}>{t('signup.confirmPassword') || 'Confirm password'}</label>
              <PasswordInput required value={form.confirm_password} onChange={e => update('confirm_password', e.target.value)}
                className={FIELD} placeholder="Repeat password" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50 text-sm">
              {loading ? t('signup.creating') || 'Creating account...' : plan === 'pro' ? t('signup.continueToProBtn') || 'Create account & continue to Pro →' : t('signup.startTrial') || 'Start free trial →'}
            </button>
            <p className="text-xs text-center text-gray-400 dark:text-gray-500">
              {t('signup.agreeTo') || 'By signing up, you agree to our'}{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">{t('signup.terms') || 'Terms of Service'}</a>
              {' '}and{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">{t('signup.privacy') || 'Privacy Policy'}</a>
            </p>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
          {t('signup.alreadyHave') || 'Already have an account?'}{' '}
          <Link to="/login" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">{t('login.signIn') || 'Sign in'}</Link>
        </p>
      </div>
    </div>
  );
}
