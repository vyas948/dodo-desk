import { Link } from 'react-router-dom';

const Section = ({ title, children }) => (
  <div className="mb-8">
    <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">{title}</h2>
    {children}
  </div>
);
const P = ({ children }) => <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">{children}</p>;
const Li = ({ children }) => <li className="text-sm text-gray-600 dark:text-gray-300 mb-1.5 leading-relaxed">{children}</li>;

export default function RefundPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link to="/signup" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← Back to sign up</Link>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12">
          <div className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">DodoBay Company Limited — DodoDesk</p>
            <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">Refund Policy</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Effective date: 25 June 2026 &nbsp;·&nbsp; Contact: contact@dodobay.com</p>
          </div>

          {/* Highlight box */}
          <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-xl p-5 mb-8">
            <p className="text-base font-semibold text-indigo-700 dark:text-indigo-300 mb-1">✅ 14-Day Money-Back Guarantee</p>
            <p className="text-sm text-indigo-600 dark:text-indigo-400">Not happy? Contact us within 14 days of your first payment for a full refund — no questions asked.</p>
          </div>

          <Section title="1. Our Commitment">
            <P>DodoBay Company Limited stands behind DodoDesk. We want you to be completely satisfied with your subscription. If you are not happy with DodoDesk for any reason, we will refund your payment in full — no questions asked — within 14 days of your first payment.</P>
          </Section>

          <Section title="2. Eligibility">
            <P>You are eligible for a full refund if:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>You contact us within <strong>14 calendar days</strong> of your first paid subscription payment</Li>
              <Li>Your account has not been suspended or terminated for violation of our Terms of Service</Li>
            </ul>
            <P>The 14-day period begins on the date your first payment is processed — not the date your free trial ends.</P>
          </Section>

          <Section title="3. How to Request a Refund">
            <P>To request a refund, email us at <strong>contact@dodobay.com</strong> with:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>The email address associated with your DodoDesk account</Li>
              <Li>Your request for a refund</Li>
            </ul>
            <P>We will process your refund within <strong>5 business days</strong>. The refund will be returned to the original payment method. Depending on your bank or card provider, it may take an additional 5–10 business days to appear on your statement.</P>
          </Section>

          <Section title="4. Monthly Plans">
            <P>For monthly subscribers, a full refund of the most recent monthly payment is available within 14 days of that payment. We do not offer partial refunds for unused days in a billing period beyond the 14-day window.</P>
          </Section>

          <Section title="5. Annual Plans">
            <P>For annual subscribers, a full refund is available within 14 days of the annual payment. After 14 days, annual subscriptions are non-refundable. You may cancel at any time to prevent renewal, and your access will continue until the end of the paid annual period.</P>
          </Section>

          <Section title="6. Free Trial">
            <P>DodoDesk offers a 14-day free trial with no credit card required. No charges are made during the trial period, so no refund is applicable for trial accounts.</P>
          </Section>

          <Section title="7. Exceptions">
            <P>We reserve the right to decline a refund if we determine that the refund policy is being abused (for example, repeated sign-up and refund requests from the same organisation).</P>
          </Section>

          <Section title="8. Cancellation">
            <P>Cancelling your subscription is separate from requesting a refund. When you cancel:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>You retain access to DodoDesk until the end of your current billing period</Li>
              <Li>Your subscription will not renew</Li>
              <Li>No further charges will be made</Li>
            </ul>
            <P>To cancel, go to <strong>Settings → Billing → Customer Portal</strong> in DodoDesk, or email contact@dodobay.com.</P>
          </Section>

          <Section title="9. Payment Processing">
            <P>All payments and refunds are processed by <strong>Paddle.com</strong>, our authorised reseller and Merchant of Record. Paddle appears on your bank statement as the merchant. If you have billing questions, you can also contact Paddle directly at paddle.com/support.</P>
          </Section>

          <Section title="10. Contact Us">
            <P>For refund requests or billing questions:</P>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-800 dark:text-white">DodoBay Company Limited</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Baptiste Lane, Terre Rouge, Mauritius</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">contact@dodobay.com</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Response time: within 1 business day</p>
            </div>
          </Section>

          <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex gap-4 text-xs text-gray-400">
              <Link to="/terms" className="hover:text-indigo-500">Terms of Service</Link>
              <Link to="/privacy" className="hover:text-indigo-500">Privacy Policy</Link>
              <Link to="/signup" className="hover:text-indigo-500">Sign Up</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
