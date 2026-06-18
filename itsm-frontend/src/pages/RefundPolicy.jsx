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
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">DodoBay Ltd — DodoDesk</p>
            <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">Refund Policy</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Effective date: June 16, 2025 &nbsp;·&nbsp; Contact: contact@dodobay.com</p>
          </div>

          <Section title="1. Overview">
            <P>DodoBay Ltd wants you to be satisfied with DodoDesk. This Refund Policy explains when and how you can request a refund for your DodoDesk subscription. All payments are processed by Paddle, our Merchant of Record.</P>
          </Section>

          <Section title="2. 14-Day Money-Back Guarantee">
            <P>If you subscribe to the DodoDesk Pro plan and are not satisfied for any reason, you may request a full refund within <strong>14 days</strong> of your initial subscription date. No questions asked.</P>
            <P>To request a refund under this guarantee, contact us at <strong>contact@dodobay.com</strong> with your account email and reason. We will process the refund within 5–10 business days.</P>
          </Section>

          <Section title="3. Refunds After 14 Days">
            <P>After the 14-day period, we do not offer refunds for the current billing period. You may cancel your subscription at any time and retain access until the end of the period you have already paid for.</P>
          </Section>

          <Section title="4. Annual Subscriptions">
            <P>For annual subscriptions, you may request a pro-rated refund for unused months within the first <strong>30 days</strong> of the annual subscription. After 30 days, annual subscriptions are non-refundable, though you may cancel to prevent renewal.</P>
          </Section>

          <Section title="5. Free Trial">
            <P>The Free Trial plan involves no payment, so no refund is applicable. You may use the free trial for up to 14 days without charge and cancel at any time with no obligation.</P>
          </Section>

          <Section title="6. Cancellation">
            <P>You may cancel your DodoDesk subscription at any time via <strong>Settings → Tenants → Manage billing</strong>. Cancellation takes effect at the end of the current billing period. You will not be charged for subsequent periods.</P>
            <P>Cancellation does not automatically trigger a refund unless you are within the 14-day money-back guarantee window.</P>
          </Section>

          <Section title="7. Failed Payments">
            <P>If a payment fails, Paddle will retry the charge automatically. If payment is not resolved within a reasonable period, your account may be downgraded to the Free plan. We do not charge fees for failed payments.</P>
          </Section>

          <Section title="8. Exceptional Circumstances">
            <P>We will consider refund requests on a case-by-case basis for exceptional circumstances such as:</P>
            <ul className="list-disc list-inside space-y-1 mb-3 ml-2">
              <Li>Extended platform outages or service failures caused by us</Li>
              <Li>Duplicate charges due to a billing error</Li>
              <Li>Charges following a reported cancellation that was not processed</Li>
            </ul>
            <P>Please contact us at contact@dodobay.com to discuss exceptional circumstances.</P>
          </Section>

          <Section title="9. How to Request a Refund">
            <P>To request a refund:</P>
            <ul className="list-disc list-inside space-y-1 mb-3 ml-2">
              <Li>Email <strong>contact@dodobay.com</strong> with subject line "Refund Request"</Li>
              <Li>Include your account email address and company name</Li>
              <Li>Briefly describe the reason for your request</Li>
            </ul>
            <P>We will respond within 2 business days and process approved refunds within 5–10 business days via Paddle to the original payment method.</P>
          </Section>

          <Section title="10. Contact">
            <ul className="list-disc list-inside space-y-1 ml-2">
              <Li>DodoBay Ltd</Li>
              <Li>Email: contact@dodobay.com</Li>
              <Li>Website: www.dodobay.com</Li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
