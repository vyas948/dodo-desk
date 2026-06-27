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
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">DodoBay Company Limited — DodoDesk</p>
            <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">Terms of Service</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Effective date: 25 June 2026 &nbsp;·&nbsp; Contact: contact@dodobay.com</p>
          </div>

          <Section title="1. Acceptance of Terms">
            <P>By creating an account, accessing, or using the DodoDesk platform operated by DodoBay Company Limited ("we", "us", "our"), you agree to be bound by these Terms of Service. If you are using DodoDesk on behalf of an organisation, you represent that you have the authority to bind that organisation to these terms.</P>
            <P>If you do not agree to these terms, please do not access or use DodoDesk.</P>
          </Section>

          <Section title="2. About Us">
            <P>DodoDesk is an IT Service Management (ITSM) SaaS platform owned and operated by:</P>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white">DodoBay Company Limited</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Company No. 236279</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Baptiste Lane, Terre Rouge, Mauritius</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">contact@dodobay.com</p>
            </div>
            <P>DodoBay Company Limited is incorporated under the Companies Act of the Republic of Mauritius.</P>
          </Section>

          <Section title="3. Description of Service">
            <P>DodoDesk provides a cloud-based IT Service Management platform including ticket management, asset tracking, knowledge base, change management, reporting, and related features. The service is provided on a subscription basis with the following plans:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li><strong>Free Trial</strong> — 14 days, no credit card required, up to 1 agent</Li>
              <Li><strong>Pro</strong> — Monthly or annual subscription, up to 5 agents</Li>
              <Li><strong>Enterprise</strong> — Unlimited agents, custom pricing, dedicated support</Li>
            </ul>
          </Section>

          <Section title="4. Account Registration">
            <P>You must provide accurate, complete, and current information when creating an account. You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You must notify us immediately at contact@dodobay.com if you suspect unauthorised access to your account.</P>
            <P>You must be at least 18 years old to use DodoDesk. By agreeing to these terms, you confirm that you meet this requirement.</P>
          </Section>

          <Section title="5. Subscriptions and Billing">
            <P>Paid subscriptions are billed in advance on a monthly or annual basis. All payments are processed securely by Paddle.com (our authorised reseller and Merchant of Record). By subscribing, you authorise Paddle to charge your payment method on a recurring basis.</P>
            <P>Prices are displayed in USD and exclude applicable taxes, which may be added at checkout depending on your location.</P>
            <P>You may cancel your subscription at any time. Cancellation takes effect at the end of the current billing period. You will not be charged again after cancellation.</P>
          </Section>

          <Section title="6. Refund Policy">
            <P>We offer a <strong>14-day money-back guarantee</strong> on all paid plans. If you are not satisfied with DodoDesk for any reason within 14 days of your first payment, contact us at contact@dodobay.com and we will issue a full refund, no questions asked.</P>
            <P>Refunds are not available after the 14-day period. Annual plan refunds are calculated on a pro-rata basis within the 14-day window only.</P>
          </Section>

          <Section title="7. Acceptable Use">
            <P>You agree not to use DodoDesk to:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>Violate any applicable law or regulation</Li>
              <Li>Transmit harmful, offensive, or unlawful content</Li>
              <Li>Attempt to gain unauthorised access to any system or network</Li>
              <Li>Resell or sublicence the service without our written consent</Li>
              <Li>Interfere with the security or integrity of the platform</Li>
              <Li>Reverse-engineer or attempt to extract the source code of the platform</Li>
            </ul>
            <P>We reserve the right to suspend or terminate accounts that violate these terms without notice.</P>
          </Section>

          <Section title="8. Data and Privacy">
            <P>We collect and process personal data in accordance with our <Link to="/privacy" className="text-indigo-600 dark:text-indigo-400 hover:underline">Privacy Policy</Link>. By using DodoDesk, you consent to such processing. You are responsible for ensuring that any personal data you upload about your users complies with applicable data protection laws.</P>
            <P>We implement industry-standard security measures to protect your data. However, no system is completely secure and we cannot guarantee absolute security.</P>
          </Section>

          <Section title="9. Intellectual Property">
            <P>DodoDesk and all associated software, designs, content, and trademarks are the exclusive property of DodoBay Company Limited. Nothing in these terms grants you any right to use our intellectual property except as necessary to use the service.</P>
            <P>You retain ownership of all data and content you upload to DodoDesk. By uploading content, you grant us a limited licence to host and process that content solely to provide the service to you.</P>
          </Section>

          <Section title="10. Service Availability">
            <P>We aim to maintain 99.9% uptime but do not guarantee uninterrupted availability. We may perform maintenance with or without notice. We are not liable for any losses arising from service downtime, interruption, or data loss.</P>
          </Section>

          <Section title="11. Limitation of Liability">
            <P>To the maximum extent permitted by Mauritius law, DodoBay Company Limited shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, arising from your use of DodoDesk.</P>
            <P>Our total cumulative liability to you for any claims arising under these terms shall not exceed the amount you paid us in the 12 months preceding the claim.</P>
          </Section>

          <Section title="12. Termination">
            <P>Either party may terminate the agreement at any time. We may suspend or terminate your account immediately if you breach these terms, fail to pay fees when due, or if required by law.</P>
            <P>Upon termination, your right to access DodoDesk ceases immediately. We will retain your data for 30 days after termination, after which it will be permanently deleted.</P>
          </Section>

          <Section title="13. Changes to Terms">
            <P>We may update these terms from time to time. We will notify you of material changes by email or in-app notification at least 14 days before the changes take effect. Continued use of DodoDesk after the effective date constitutes acceptance of the updated terms.</P>
          </Section>

          <Section title="14. Governing Law">
            <P>These terms are governed by the laws of the Republic of Mauritius. Any disputes shall be subject to the exclusive jurisdiction of the courts of Mauritius.</P>
          </Section>

          <Section title="15. Contact">
            <P>For questions about these terms, please contact us at:</P>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-800 dark:text-white">DodoBay Company Limited</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Baptiste Lane, Terre Rouge, Mauritius</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">contact@dodobay.com</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">dododesk.dodobay.com</p>
            </div>
          </Section>

          <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex gap-4 text-xs text-gray-400">
              <Link to="/privacy" className="hover:text-indigo-500">Privacy Policy</Link>
              <Link to="/refunds" className="hover:text-indigo-500">Refund Policy</Link>
              <Link to="/signup" className="hover:text-indigo-500">Sign Up</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
