import { Link } from 'react-router-dom';

const Section = ({ title, children }) => (
  <div className="mb-8">
    <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-3">{title}</h2>
    {children}
  </div>
);
const P = ({ children }) => <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">{children}</p>;
const Li = ({ children }) => <li className="text-sm text-gray-600 dark:text-gray-300 mb-1.5 leading-relaxed">{children}</li>;

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link to="/signup" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← Back to sign up</Link>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 md:p-12">
          <div className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">DodoBay Company Limited — DodoDesk</p>
            <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">Privacy Policy</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Effective date: 25 June 2026 &nbsp;·&nbsp; Contact: contact@dodobay.com</p>
          </div>

          <P>DodoBay Company Limited ("we", "us", "our") operates DodoDesk and is committed to protecting your personal data. This Privacy Policy explains what data we collect, how we use it, and your rights.</P>

          <Section title="1. Who We Are">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white">DodoBay Company Limited</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Company No. 236279</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Baptiste Lane, Terre Rouge, Mauritius</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">contact@dodobay.com</p>
            </div>
            <P>We are the data controller for personal data collected through DodoDesk.</P>
          </Section>

          <Section title="2. Data We Collect">
            <P><strong>Account data:</strong> When you sign up, we collect your name, email address, company name, and password (stored as a secure hash). We never store your password in plain text.</P>
            <P><strong>Usage data:</strong> We collect information about how you use DodoDesk, including ticket data, asset records, knowledge base articles, and audit logs. This data belongs to your organisation and is processed on your behalf.</P>
            <P><strong>Billing data:</strong> Payment information is collected and processed by Paddle.com. We do not store your credit card details — only your subscription status and plan level.</P>
            <P><strong>Technical data:</strong> We automatically collect your IP address, browser type, and device information for security and performance purposes.</P>
            <P><strong>Communications:</strong> If you contact us by email, we retain those communications to assist you.</P>
          </Section>

          <Section title="3. How We Use Your Data">
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>To provide, operate, and improve the DodoDesk platform</Li>
              <Li>To manage your account and subscription</Li>
              <Li>To send transactional emails (ticket notifications, password resets, billing receipts)</Li>
              <Li>To respond to support requests and enquiries</Li>
              <Li>To detect and prevent fraud, abuse, and security incidents</Li>
              <Li>To comply with legal obligations</Li>
            </ul>
            <P>We do not sell your personal data to third parties. We do not use your data for advertising.</P>
          </Section>

          <Section title="4. Data Sharing">
            <P>We share your data only with the following trusted third parties, solely to provide the service:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li><strong>Paddle.com</strong> — Payment processing and subscription management (Merchant of Record)</Li>
              <Li><strong>Render.com</strong> — Cloud hosting of the DodoDesk API</Li>
              <Li><strong>Vercel</strong> — Hosting of the DodoDesk frontend application</Li>
              <Li><strong>Neon</strong> — PostgreSQL database hosting</Li>
              <Li><strong>Cloudinary</strong> — File and image storage</Li>
              <Li><strong>Resend</strong> — Transactional email delivery</Li>
            </ul>
            <P>All third-party processors are contractually required to protect your data and may not use it for their own purposes.</P>
            <P>We may disclose your data if required by law, court order, or government authority in Mauritius or applicable jurisdictions.</P>
          </Section>

          <Section title="5. Data Retention">
            <P>We retain your account data for as long as your account is active. If you cancel your subscription, we retain your data for 30 days to allow for account recovery, after which it is permanently deleted.</P>
            <P>Billing records are retained for 7 years as required by Mauritian financial regulations.</P>
            <P>You may request deletion of your data at any time by emailing contact@dodobay.com.</P>
          </Section>

          <Section title="6. Security">
            <P>We implement industry-standard security measures including:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>All data encrypted in transit via HTTPS/TLS</Li>
              <Li>Passwords hashed using bcrypt</Li>
              <Li>Multi-factor authentication (MFA) available on Pro plans</Li>
              <Li>Account lockout after failed login attempts</Li>
              <Li>Single-session enforcement to prevent unauthorised concurrent access</Li>
              <Li>Complete audit logging of all administrative actions</Li>
            </ul>
            <P>No method of data transmission or storage is 100% secure. In the event of a data breach affecting your personal data, we will notify you within 72 hours as required by applicable law.</P>
          </Section>

          <Section title="7. Cookies">
            <P>DodoDesk uses only essential cookies necessary for the platform to function (authentication tokens stored in localStorage). We do not use advertising or tracking cookies. Our cookie consent banner allows you to accept or decline non-essential cookies.</P>
          </Section>

          <Section title="8. Your Rights">
            <P>Under applicable data protection law, you have the right to:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li><strong>Access</strong> — request a copy of the personal data we hold about you</Li>
              <Li><strong>Rectification</strong> — request correction of inaccurate data</Li>
              <Li><strong>Erasure</strong> — request deletion of your personal data</Li>
              <Li><strong>Portability</strong> — receive your data in a structured, machine-readable format</Li>
              <Li><strong>Objection</strong> — object to processing of your data in certain circumstances</Li>
              <Li><strong>Restriction</strong> — request that we restrict processing of your data</Li>
            </ul>
            <P>To exercise any of these rights, email contact@dodobay.com. We will respond within 30 days.</P>
          </Section>

          <Section title="9. International Transfers">
            <P>DodoDesk is operated from Mauritius. Your data may be processed by our third-party providers in other countries. Where data is transferred outside Mauritius, we ensure appropriate safeguards are in place.</P>
          </Section>

          <Section title="10. Children">
            <P>DodoDesk is a business application not intended for use by anyone under the age of 18. We do not knowingly collect personal data from minors.</P>
          </Section>

          <Section title="11. Changes to This Policy">
            <P>We may update this Privacy Policy from time to time. We will notify you of material changes by email at least 14 days before they take effect. The current version is always available at dododesk.dodobay.com/privacy.</P>
          </Section>

          <Section title="12. Contact">
            <P>For any privacy-related questions or requests, please contact:</P>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-800 dark:text-white">DodoBay Company Limited — Privacy</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Baptiste Lane, Terre Rouge, Mauritius</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">contact@dodobay.com</p>
            </div>
          </Section>

          <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex gap-4 text-xs text-gray-400">
              <Link to="/terms" className="hover:text-indigo-500">Terms of Service</Link>
              <Link to="/refunds" className="hover:text-indigo-500">Refund Policy</Link>
              <Link to="/signup" className="hover:text-indigo-500">Sign Up</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
