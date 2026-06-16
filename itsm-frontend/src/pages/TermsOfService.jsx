import { Link } from 'react-router-dom';

const Section = ({ title, children }) => (
  <div className="mb-8">
    <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">{title}</h2>
    {children}
  </div>
);
const P = ({ children }) => <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">{children}</p>;
const Li = ({ children }) => <li className="text-sm text-gray-600 dark:text-gray-300 mb-1.5 leading-relaxed">{children}</li>;

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link to="/signup" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← Back to sign up</Link>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12">
          <div className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">DodoBay Ltd — DodoDesk</p>
            <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">Terms of Service</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Effective date: June 16, 2025 &nbsp;·&nbsp; Contact: contact@dodobay.com</p>
          </div>

          <Section title="1. Acceptance of Terms">
            <P>By creating an account, accessing, or using the DodoDesk platform operated by DodoBay Ltd ("we", "us", "our"), you agree to be bound by these Terms of Service. If you are using DodoDesk on behalf of an organisation, you represent that you have authority to bind that organisation to these terms.</P>
          </Section>

          <Section title="2. Description of Service">
            <P>DodoDesk is a cloud-based IT Service Management (ITSM) platform providing ticket management, asset management, knowledge base, service catalog, approval workflows, reporting, and related features, provided on a subscription basis.</P>
          </Section>

          <Section title="3. Account Registration">
            <P>To use DodoDesk, you must provide accurate registration information, verify your email address before your account is activated, and maintain the security of your credentials. You are responsible for all activity that occurs under your account.</P>
          </Section>

          <Section title="4. Subscription Plans and Billing">
            <ul className="list-disc list-inside space-y-1 mb-3 ml-2">
              <Li>Free Trial: 14-day trial with 1 agent/admin seat. Core ticketing features only. No payment required.</Li>
              <Li>Pro Plan: USD $59/month (or USD $637/year — 10% discount). Up to 5 agent/admin seats. Seats 6–10 available at USD $12/seat/month. Full features including branding, SLA, MFA, SSO, and approval workflows.</Li>
              <Li>Enterprise Plan: Custom pricing. Unlimited seats. Contact contact@dodobay.com.</Li>
            </ul>
            <P>Billing is managed by Paddle, our Merchant of Record. All prices are in USD exclusive of applicable taxes, which Paddle calculates and collects.</P>
          </Section>

          <Section title="5. Free Trial">
            <P>The Free Trial provides core ticketing for 14 days with one agent/admin seat at no charge. After 14 days, new ticket creation is restricted until you upgrade to a paid plan. Your data remains accessible throughout.</P>
          </Section>

          <Section title="6. Acceptable Use">
            <P>You agree not to use DodoDesk to violate any law, transmit harmful content, gain unauthorised access to other tenants' data, introduce malicious code, or resell access to the platform without our written consent. We reserve the right to suspend accounts that violate these restrictions.</P>
          </Section>

          <Section title="7. Data Ownership">
            <P>You retain full ownership of all data you create within DodoDesk. We do not claim intellectual property rights over your content. You grant us a limited licence to store and process your data solely to provide the service.</P>
          </Section>

          <Section title="8. Intellectual Property">
            <P>All intellectual property rights in the DodoDesk platform — including software, design, trademarks, and documentation — belong to DodoBay Ltd. These terms do not grant you any rights to our intellectual property except the limited right to use the platform.</P>
          </Section>

          <Section title="9. Availability">
            <P>We aim to provide a reliable service but do not guarantee uninterrupted availability. We may perform scheduled maintenance that temporarily affects access. We are not liable for losses resulting from service interruptions beyond our reasonable control.</P>
          </Section>

          <Section title="10. Limitation of Liability">
            <P>To the maximum extent permitted by law, DodoBay Ltd shall not be liable for indirect, incidental, or consequential damages including loss of profits, data, or business opportunity. Our total aggregate liability shall not exceed the amount you paid us in the 12 months preceding the claim.</P>
          </Section>

          <Section title="11. Termination">
            <P>Either party may terminate at any time. You may cancel via Settings → Tenants → Manage billing. Upon termination, access ceases at the end of the current billing period. Your data is retained for 90 days after termination, then permanently deleted.</P>
          </Section>

          <Section title="12. Governing Law">
            <P>These terms are governed by the laws of the Republic of Mauritius. Any disputes shall be subject to the exclusive jurisdiction of the courts of Mauritius.</P>
          </Section>

          <Section title="13. Changes to These Terms">
            <P>We may update these terms from time to time and will notify you of material changes with at least 14 days' notice via email or in-platform notification.</P>
          </Section>

          <Section title="14. Contact">
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
