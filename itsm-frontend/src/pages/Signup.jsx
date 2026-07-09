import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { apiFetch } from '../apiFetch';
import { useToast } from '../contexts/ToastContext';
import { API } from '../api';

// ─── Pricing data ────────────────────────────────────────────────────────────
const ANNUAL_DISCOUNT = 0.15; // 15% off annual billing

const PLANS = [
  {
    key: 'essentials',
    name: 'Essentials',
    badge: null,
    monthlyPrice: 15,           // $15/agent/month billed monthly
    annualMonthly: 12.75,       // $15 × 0.85 = $12.75/agent/month billed annually
    annualTotal: 153,           // $180 × 0.85 = $153/agent/year
    color: '#6366f1',
    lightBg: '#eef2ff',
    description: 'For small IT shops moving off shared email inboxes.',
    audience: 'Small teams',
    disruptor: '🔥 Slack & Teams integration included — competitors charge extra',
    features: [
      'Multi-channel ticketing (email, portal, widget)',
      'Built-in Slack & MS Teams integration',
      'Service Catalog & request forms',
      'Asset tracking up to 250 assets',
      'Basic Knowledge Base',
      'Standard SLAs (8×5 business hours)',
      '2 GB storage per agent',
    ],
    cta: 'Start free trial',
    trial: true,
  },
  {
    key: 'business',
    name: 'Business',
    badge: 'Most popular',
    monthlyPrice: 35,           // $35/agent/month billed monthly
    annualMonthly: 29.75,       // $35 × 0.85 = $29.75/agent/month billed annually
    annualTotal: 357,           // $420 × 0.85 = $357/agent/year
    color: '#0ea5e9',
    lightBg: '#e0f2fe',
    description: 'For growing IT departments that need automation, not enterprise overhead.',
    audience: 'Growing teams',
    disruptor: '🔥 Asset tracking + MFA + Audit Log included — competitors charge extra for all three',
    features: [
      'Everything in Essentials',
      'Asset tracking up to 1,000 assets',
      'Visual workflow automator',
      'Multiple SLA policies & business hours',
      'Multi-factor authentication (MFA)',
      'Approval workflows',
      'Full audit log',
      'Round-robin ticket assignment',
      'Advanced reporting & custom analytics',
    ],
    cta: 'Subscribe now',
    trial: false,
  },
  {
    key: 'pro',
    name: 'Pro',
    badge: 'Best value',
    monthlyPrice: 65,           // $65/agent/month billed monthly
    annualMonthly: 55.25,       // $65 × 0.85 = $55.25/agent/month billed annually
    annualTotal: 663,           // $780 × 0.85 = $663/agent/year
    color: '#8b5cf6',
    lightBg: '#ede9fe',
    description: 'For mature IT teams following ITIL frameworks — full CMDB, change management and AI native.',
    audience: 'ITIL teams',
    disruptor: '🔥 AI chatbot included — other platforms charge this as a $29 add-on',
    features: [
      'Everything in Business',
      'Full ITIL: Change, Problem & Release Management',
      'Advanced CMDB up to 5,000 assets',
      '500 AI chatbot conversations/month',
      'Advanced analytics & scheduled reports',
      'Custom dashboards',
    ],
    cta: 'Subscribe now',
    trial: false,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    badge: null,
    monthlyPrice: null,
    annualMonthly: null,
    annualTotal: null,
    color: '#0f172a',
    lightBg: '#f1f5f9',
    description: 'For regulated industries and large organisations requiring maximum security and compliance.',
    audience: 'Enterprise',
    disruptor: '🔥 SSO & Audit Logs included — competitors charge separately',
    features: [
      'Everything in Pro',
      'SSO (Google, Microsoft, Okta, SAML)',
      'IP whitelisting & advanced audit logs',
      'Sandbox environments',
      'Unlimited assets & storage',
      'Dedicated account management',
    ],
    cta: 'Contact us',
    trial: false,
  },
];

const COMPARE = [
  { feature: 'Slack & Teams integration', essentials: true, business: true, pro: true, enterprise: true },
  { feature: 'Knowledge Base', essentials: true, business: true, pro: true, enterprise: true },
  { feature: 'Service Catalog', essentials: true, business: true, pro: true, enterprise: true },
  { feature: 'Asset tracking', essentials: '250 assets', business: '1,000 assets', pro: '5,000 assets', enterprise: 'Unlimited' },
  { feature: 'Workflow automation', essentials: false, business: true, pro: true, enterprise: true },
  { feature: 'Multiple SLA policies', essentials: false, business: true, pro: true, enterprise: true },
  { feature: 'Approval workflows', essentials: false, business: true, pro: true, enterprise: true },
  { feature: 'Multi-factor authentication (MFA)', essentials: false, business: true, pro: true, enterprise: true },
  { feature: 'Audit log', essentials: false, business: true, pro: true, enterprise: true },
  { feature: 'Change management', essentials: false, business: false, pro: true, enterprise: true },
  { feature: 'Problem management', essentials: false, business: false, pro: true, enterprise: true },
  { feature: 'AI chatbot', essentials: false, business: false, pro: '500 conv/mo', enterprise: 'Unlimited' },
  { feature: 'Custom analytics', essentials: false, business: true, pro: true, enterprise: true },
  { feature: 'SSO / IP whitelisting', essentials: false, business: false, pro: false, enterprise: true },
  { feature: 'Sandbox environment', essentials: false, business: false, pro: false, enterprise: true },
  { feature: 'Storage', essentials: '2 GB/agent', business: '10 GB/agent', pro: '25 GB/agent', enterprise: 'Unlimited' },

];

// ─── Component ────────────────────────────────────────────────────────────────
export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const initialPlan = searchParams.get('plan') || 'starter';
  const [selectedPlan, setSelectedPlan] = useState(initialPlan);
  const [billing, setBilling] = useState('annual'); // 'annual' | 'monthly'
  const [step, setStep] = useState('pricing'); // 'pricing' | 'register' | 'done'
  const [showCompare, setShowCompare] = useState(false);
  const [form, setForm] = useState({ company_name: '', full_name: '', email: '', password: '', confirm_password: '' });
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [branding, setBranding] = useState({ logo_url: null, company_name: 'DodoDesk', primary_color: '#059669' });

  useEffect(() => {
    fetch(`${API}/branding/public`).then(r => r.json()).then(setBranding).catch(() => {});
  }, []);

  const plan = PLANS.find(p => p.key === selectedPlan) || PLANS[0];
  const isEnterprise = selectedPlan === 'enterprise';

  const handlePlanSelect = (key) => {
    if (key === 'enterprise') { window.location.href = 'mailto:contact@dodobay.com?subject=DodoDesk Enterprise Enquiry'; return; }
    setSelectedPlan(key);
    setStep('register');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Plans that get a free trial vs paid-from-day-one
  const isTrial = selectedPlan === 'essentials';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!agreed) { toast.error('Please accept the Terms of Service to continue.'); return; }
    if (form.password !== form.confirm_password) { toast.error('Passwords do not match.'); return; }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      await apiFetch('/auth/signup', null, {
        method: 'POST',
        body: JSON.stringify({
          company_name: form.company_name, full_name: form.full_name,
          email: form.email, password: form.password,
          plan: selectedPlan,   // send actual plan (essentials/business/pro) - backend stores as trial
          billing_interval: billing,
        }),
      });
      setStep('done');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inp = "w-full border border-gray-200 rounded-xl px-4 py-3 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-400";
  const lbl = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5";

  // ── Done screen ──────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-xl p-10 w-full max-w-md text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Check your inbox</h2>
        <p className="text-gray-500 mb-2">We've sent a verification link to <strong className="text-gray-700">{form.email}</strong></p>
        <p className="text-sm text-gray-400 mb-6">Click the link to activate your account and start your <strong className="text-gray-600">{plan.name} trial</strong>.</p>
        <div className="bg-emerald-50 rounded-2xl p-4 mb-4 text-left">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Your 14-day {plan.name} trial includes</p>
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">No card needed</span>
          </div>
          <ul className="space-y-1">
            {plan.features.slice(0, 4).map(f => (
              <li key={f} className="text-sm text-emerald-800 flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">✓</span> {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-gray-400 mb-6">After 14 days, your account moves to the Free plan unless you subscribe. Your data is always safe.</p>
        <Link to="/login" className="text-sm text-emerald-600 hover:underline">Already verified? Log in →</Link>
      </div>
    </div>
  );

  // ── Register form ────────────────────────────────────────────────────────────
  if (step === 'register') return (
    <div className="min-h-screen bg-gradient-to-br from-white to-emerald-50 flex">
      {/* Left — plan summary */}
      <div className="hidden lg:flex w-2/5 bg-gradient-to-br from-emerald-600 to-teal-700 p-12 flex-col justify-between">
        <div>
          <Link to="/" className="flex items-center gap-3 mb-12">
            {branding.logo_url ? (
              <img src={branding.logo_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
            ) : (
              <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center">
                <svg viewBox="0 0 40 40" className="w-5 h-5" fill="none">
                  <ellipse cx="20" cy="22" rx="13" ry="11" fill="white" fillOpacity="0.9"/>
                  <ellipse cx="20" cy="14" rx="8" ry="7" fill="white" fillOpacity="0.9"/>
                  <circle cx="17.5" cy="13" r="1.5" fill="#6366f1"/>
                  <circle cx="22.5" cy="13" r="1.5" fill="#6366f1"/>
                </svg>
              </div>
            )}
            <span className="text-white font-bold text-xl">{branding.company_name}</span>
          </Link>

          <div className="mb-8">
            <span className="text-emerald-300 text-sm font-medium uppercase tracking-widest">You selected</span>
            <h2 className="text-4xl font-bold text-white mt-1">{plan.name}</h2>
            {plan.monthlyPrice && (
              <p className="text-emerald-200 mt-2">
                <span className="text-2xl font-bold text-white">
                  ${billing === 'annual' ? plan.annualTotal : plan.monthlyPrice}
                </span>
                <span className="text-sm"> {billing === 'annual' ? '/agent/year' : '/agent/month'}</span>
                {billing === 'annual' && (
                  <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded-full">
                    15% off
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="space-y-3">
            {plan.features.map(f => (
              <div key={f} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <span className="text-emerald-100 text-sm">{f}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 p-4 bg-white/10 rounded-2xl">
            <p className="text-white text-sm font-medium">{plan.disruptor}</p>
          </div>
        </div>

        <div>
          <button onClick={() => setStep('pricing')} className="text-emerald-300 text-sm hover:text-white transition flex items-center gap-1">
            ← Change plan
          </button>
          <p className="text-emerald-400 text-xs mt-4">
            {isTrial
              ? 'Free 14-day trial · No credit card required · Cancel anytime'
              : 'Subscription required after setup · Cancel anytime'}
          </p>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <button onClick={() => setStep('pricing')} className="text-gray-400 hover:text-gray-600 text-sm flex items-center gap-1 mb-8 lg:hidden">
            ← Back to plans
          </button>

          <h1 className="text-2xl font-bold text-gray-900 mb-1">Create your account</h1>
          <p className="text-gray-500 text-sm mb-8">
            {isTrial
              ? 'Start your free 14-day trial — no credit card needed.'
              : 'Create your account to get started. You\'ll be prompted to add billing after setup.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={lbl}>Company name</label>
              <input type="text" required placeholder="Acme Corp" value={form.company_name}
                     onChange={e => setForm(f => ({...f, company_name: e.target.value}))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Your full name</label>
              <input type="text" required placeholder="Jane Smith" value={form.full_name}
                     onChange={e => setForm(f => ({...f, full_name: e.target.value}))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Work email</label>
              <input type="email" required placeholder="jane@acmecorp.com" value={form.email}
                     onChange={e => setForm(f => ({...f, email: e.target.value}))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Password</label>
              <input type="password" required placeholder="Min. 8 characters" value={form.password}
                     onChange={e => setForm(f => ({...f, password: e.target.value}))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Confirm password</label>
              <input type="password" required placeholder="Repeat password" value={form.confirm_password}
                     onChange={e => setForm(f => ({...f, confirm_password: e.target.value}))} className={inp} />
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                     className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600" />
              <span className="text-sm text-gray-500">
                I agree to DodoDesk's{' '}
                <Link to="/terms" className="text-emerald-600 hover:underline">Terms of Service</Link>
                {' '}and{' '}
                <Link to="/privacy" className="text-emerald-600 hover:underline">Privacy Policy</Link>
              </span>
            </label>

            <button type="submit" disabled={loading}
                    className="w-full py-3.5 rounded-xl font-semibold text-white transition disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              {loading ? 'Creating account...' : isTrial ? 'Create account & start trial' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-emerald-600 hover:underline font-medium">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );

  // ── Pricing page ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur z-50">
        <Link to="/" className="flex items-center gap-2.5">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-lg flex items-center justify-center"
                 style={{ background: branding.primary_color || '#059669' }}>
              <svg viewBox="0 0 40 40" className="w-5 h-5" fill="none">
                <ellipse cx="20" cy="22" rx="13" ry="11" fill="white" fillOpacity="0.95"/>
                <ellipse cx="20" cy="14" rx="8" ry="7" fill="white" fillOpacity="0.95"/>
                <circle cx="17.5" cy="13" r="1.5" fill={branding.primary_color || '#059669'}/>
                <circle cx="22.5" cy="13" r="1.5" fill={branding.primary_color || '#059669'}/>
              </svg>
            </div>
          )}
          <span className="font-bold text-gray-900 text-lg">{branding.company_name}</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/login" className="text-sm text-gray-500 hover:text-gray-700">Log in</Link>
          <button onClick={() => setStep('register')}
                  className="text-sm bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition font-medium">
            Start free trial
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="text-center px-4 pt-16 pb-12 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
          Free trial on Essentials · No credit card required · Cancel anytime
        </div>
        <h1 className="text-5xl font-extrabold text-gray-900 tracking-tight mb-4 leading-tight">
          ITSM that doesn't<br />cost a fortune
        </h1>
        <p className="text-xl text-gray-500 mb-8">
          Up to 46% cheaper than Freshservice. Richer than Jira. Everything your IT team actually needs.
        </p>

        {/* Billing toggle */}
        <div className="inline-flex items-center bg-gray-100 rounded-xl p-1 gap-1">
          <button onClick={() => setBilling('monthly')}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition ${billing==='monthly' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            Monthly
          </button>
          <button onClick={() => setBilling('annual')}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${billing==='annual' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            Annual
            <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">Save 15%</span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="max-w-6xl mx-auto px-4 pb-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {PLANS.map(p => {
          const isSelected = selectedPlan === p.key;
          return (
            <div key={p.key}
                 onClick={() => setSelectedPlan(p.key)}
                 className={`relative rounded-2xl border-2 cursor-pointer transition-all ${isSelected ? 'border-emerald-500 shadow-xl shadow-emerald-100' : 'border-gray-100 hover:border-gray-200 hover:shadow-md'}`}
                 style={{ background: isSelected ? p.lightBg : 'white' }}>
              {p.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="text-xs font-bold px-3 py-1 rounded-full text-white"
                        style={{ background: p.color }}>{p.badge}</span>
                </div>
              )}
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: p.color }}>{p.audience}</span>
                  {isSelected && <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: p.color }}>
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                    </svg>
                  </div>}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">{p.name}</h3>
                <p className="text-xs text-gray-500 mb-4 leading-relaxed">{p.description}</p>

                {p.monthlyPrice ? (
                  <div className="mb-5">
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-gray-900">
                        ${billing === 'annual' ? p.annualTotal : p.monthlyPrice}
                      </span>
                      <span className="text-gray-400 text-sm mb-1">
                        {billing === 'annual' ? '/agent/year' : '/agent/mo'}
                      </span>
                    </div>
                    {billing === 'annual' ? (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-xs text-gray-400 line-through">${p.monthlyPrice * 12}/agent/yr</p>
                        <p className="text-xs text-green-600 font-semibold">15% off — save ${p.monthlyPrice * 12 - p.annualTotal}/agent/yr</p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">billed monthly</p>
                    )}
                  </div>
                ) : (
                  <div className="mb-5">
                    <span className="text-3xl font-extrabold text-gray-900">Custom</span>
                    <p className="text-xs text-gray-400 mt-1">Contact us for pricing</p>
                  </div>
                )}

                <button
                  onClick={() => handlePlanSelect(p.key)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition mb-5"
                  style={isSelected
                    ? { background: p.color, color: 'white' }
                    : { background: '#f3f4f6', color: '#374151' }}>
                  {p.cta}
                </button>

                <div className="space-y-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">What's included</p>
                  {p.features.map(f => (
                    <div key={f} className="flex items-start gap-2.5">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: p.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
                      </svg>
                      <span className="text-xs text-gray-600 leading-relaxed">{f}</span>
                    </div>
                  ))}
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-[11px] text-gray-400 leading-relaxed italic">{p.disruptor.replace('🔥 ', '')}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* vs competitors strip */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 py-10 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-white text-2xl font-bold mb-2">See how DodoDesk compares</h2>
          <p className="text-emerald-200 text-sm mb-6">Same features. Half the price. None of the add-on surprises.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { vs: 'vs Freshservice Pro', them: '$99', us: '$65', save: '34%' },
              { vs: 'vs JSM Premium', them: '$54', us: '$35', save: '35%' },
              { vs: 'vs Zendesk Suite', them: '$115', us: '$65', save: '43%' },
              { vs: 'vs Zoho Desk', them: '$40', us: '$15', save: '62%' },
            ].map(c => (
              <div key={c.vs} className="bg-white/10 rounded-xl p-4 text-left">
                <p className="text-emerald-200 text-xs mb-2">{c.vs}</p>
                <div className="flex items-center gap-2">
                  <span className="text-white/50 line-through text-sm">{c.them}</span>
                  <span className="text-white font-bold text-lg">{c.us}</span>
                  <span className="bg-green-400/20 text-green-300 text-xs font-bold px-1.5 py-0.5 rounded">{c.save} off</span>
                </div>
                <p className="text-emerald-300 text-xs mt-1">per agent/month</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Feature comparison table */}
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Full feature comparison</h2>
          <p className="text-gray-500">See exactly what you get on each plan.</p>
        </div>
        <button onClick={() => setShowCompare(!showCompare)}
                className="mx-auto flex items-center gap-2 text-emerald-600 font-medium text-sm mb-6 hover:underline">
          {showCompare ? '▲ Hide' : '▼ Show'} full comparison table
        </button>

        {showCompare && (
          <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-6 py-4 text-gray-500 font-semibold w-1/3">Feature</th>
                  {PLANS.map(p => (
                    <th key={p.key} className="px-4 py-4 text-center font-bold" style={{ color: p.color }}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="px-6 py-3.5 text-gray-700 font-medium">
                      {row.feature}
                      {row.note && <span className="ml-2 text-xs text-orange-500 font-normal">({row.note})</span>}
                    </td>
                    {['essentials','business','pro','enterprise'].map(tier => {
                      const val = row[tier];
                      return (
                        <td key={tier} className="px-4 py-3.5 text-center">
                          {val === true ? (
                            <span className="text-green-500 text-lg">✓</span>
                          ) : val === false ? (
                            <span className="text-gray-200 text-lg">—</span>
                          ) : (
                            <span className="text-gray-600 text-xs font-medium">{val}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FAQ */}
      <div className="bg-gray-50 py-16 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Common questions</h2>
          <div className="space-y-4">
            {[
              { q: 'Do I need a credit card to start?', a: 'No — the Essentials plan includes a free 14-day trial with no payment details required. Business and Pro plans require payment setup after account creation.' },
              { q: 'What happens when my trial ends?', a: 'We\'ll email you before your trial expires. If you don\'t subscribe, your account moves to read-only mode for 7 days so you can export your data.' },
              { q: 'Can I switch plans later?', a: 'Yes — upgrade or downgrade anytime from Settings → Billing. Changes take effect at the next billing cycle.' },
              { q: 'Is pricing per agent or per company?', a: 'Per agent/admin. Employees who only raise tickets (not resolve them) don\'t count toward your agent seats.' },
              { q: 'What\'s included in the free 1-agent plan?', a: 'Solo IT managers get the Starter tier permanently free for 1 agent. Ideal for SMBs with a single IT person.' },
            ].map(item => (
              <details key={item.q} className="bg-white rounded-xl border border-gray-100 px-6 py-4 group">
                <summary className="font-medium text-gray-800 cursor-pointer list-none flex items-center justify-between">
                  {item.q}
                  <span className="text-gray-400 group-open:rotate-180 transition-transform text-lg">⌄</span>
                </summary>
                <p className="text-gray-500 text-sm mt-3 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="text-center py-16 px-4">
        <h2 className="text-3xl font-bold text-gray-900 mb-3">Ready to get started?</h2>
        <p className="text-gray-500 mb-8">Join IT teams already running on DodoDesk.</p>
        <button onClick={() => { setSelectedPlan('essentials'); setStep('register'); window.scrollTo({top:0}); }}
                className="inline-flex items-center gap-2 bg-emerald-600 text-white px-8 py-4 rounded-xl font-semibold hover:bg-emerald-700 transition text-lg">
          Start free with Essentials
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3"/>
          </svg>
        </button>
        <p className="text-gray-400 text-sm mt-4">
          Need more capacity?{' '}
          <button onClick={() => { setSelectedPlan('business'); setStep('register'); window.scrollTo({top:0}); }} className="text-emerald-600 hover:underline">Business</button>
          {' '}or{' '}
          <button onClick={() => { setSelectedPlan('pro'); setStep('register'); window.scrollTo({top:0}); }} className="text-emerald-600 hover:underline">Pro</button>
          {' '}plans available. Questions?{' '}
          <a href="mailto:contact@dodobay.com" className="text-emerald-600 hover:underline">contact@dodobay.com</a>
        </p>
      </div>

      <div className="border-t border-gray-100 py-6 px-4 flex flex-wrap items-center justify-between gap-4 text-sm text-gray-400">
        <span>© {new Date().getFullYear()} DodoBay Ltd. All rights reserved.</span>
        <div className="flex gap-4">
          <Link to="/privacy" className="hover:text-gray-600">Privacy</Link>
          <Link to="/terms" className="hover:text-gray-600">Terms</Link>
          <Link to="/refund-policy" className="hover:text-gray-600">Refund Policy</Link>
        </div>
      </div>
    </div>
  );
}
