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
            <p className="text-sm text-gray-500 dark:text-gray-400">Effective date: 1 July 2026 &nbsp;·&nbsp; Contact: privacy@dodobay.com</p>
          </div>

          <P>DodoBay Company Limited ("we", "us", "our") operates DodoDesk and is committed to protecting your personal data. This Privacy Policy explains what data we collect, how we use it, and your rights under the General Data Protection Regulation (GDPR) and applicable data protection laws.</P>

          <Section title="1. Who We Are (Data Controller)">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white">DodoBay Company Limited</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Company No. 236279</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Baptiste Lane, Terre Rouge, Mauritius</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">privacy@dodobay.com</p>
            </div>
            <P>We are the <strong>data controller</strong> for personal data collected directly through DodoDesk (account registration, billing). For data your organisation enters into DodoDesk (tickets, employee records, assets), we act as a <strong>data processor</strong> on your behalf — you remain the data controller for that data.</P>
          </Section>

          <Section title="2. Data We Collect">
            <P><strong>Account data:</strong> Name, email address, company name, and password (stored as a bcrypt hash — never in plain text).</P>
            <P><strong>Profile data:</strong> Job title, department, phone number, profile photo, and availability status — provided voluntarily.</P>
            <P><strong>Operational data:</strong> Tickets, comments, assets, knowledge base articles, audit logs, and other content you or your team create within DodoDesk. This data belongs to your organisation.</P>
            <P><strong>Billing data:</strong> Payment information is collected and processed by Dodo Payments. We store only your subscription status, plan level, and a customer reference ID. We never store card details.</P>
            <P><strong>Technical data:</strong> IP address, browser type, device information, and session tokens — collected automatically for security and platform operation.</P>
            <P><strong>Communications:</strong> If you contact us by email, we retain those communications to assist you and improve our service.</P>
          </Section>

          <Section title="3. Legal Basis for Processing">
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li><strong>Contract performance (Art. 6(1)(b)):</strong> Processing necessary to provide the DodoDesk service you subscribed to.</Li>
              <Li><strong>Legitimate interests (Art. 6(1)(f)):</strong> Security monitoring, fraud prevention, product improvement, and platform stability.</Li>
              <Li><strong>Legal obligation (Art. 6(1)(c)):</strong> Retaining billing records for tax and accounting purposes.</Li>
              <Li><strong>Consent (Art. 6(1)(a)):</strong> Marketing communications (where applicable) — you may withdraw consent at any time.</Li>
            </ul>
          </Section>

          <Section title="4. How We Use Your Data">
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>To provide, operate, and improve the DodoDesk platform</Li>
              <Li>To manage your account, subscription, and billing</Li>
              <Li>To send transactional emails (ticket notifications, password resets, billing receipts)</Li>
              <Li>To enforce our Terms of Service and prevent fraud or abuse</Li>
              <Li>To comply with legal obligations</Li>
            </ul>
          </Section>

          <Section title="5. Sub-Processors">
            <P>We share your data with the following trusted third-party sub-processors, each bound by data processing agreements:</P>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-gray-200 dark:border-gray-600 rounded-lg">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Sub-processor</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Purpose</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                  {[
                    ['Render (Render Services Inc.)', 'Application hosting (backend API)', 'USA'],
                    ['Neon (Neon Inc.)', 'PostgreSQL database hosting', 'USA'],
                    ['Vercel Inc.', 'Frontend hosting (web application)', 'USA'],
                    ['Cloudinary Ltd.', 'File and image storage (logos, attachments, photos)', 'USA'],
                    ['Resend Inc.', 'Transactional email delivery', 'USA'],
                    ['Dodo Payments', 'Payment processing and subscription management', 'USA'],
                    ['Sentry (Functional Software Inc.)', 'Error monitoring and performance', 'USA'],
                  ].map(([name, purpose, location]) => (
                    <tr key={name} className="bg-white dark:bg-gray-800">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 font-medium">{name}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{purpose}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P className="mt-3">All US-based sub-processors operate under Standard Contractual Clauses (SCCs) to ensure adequate protection for transfers from the EU/EEA.</P>
          </Section>

          <Section title="6. Data Retention">
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li><strong>Active accounts:</strong> Data retained for the duration of your subscription.</Li>
              <Li><strong>Cancelled accounts:</strong> Data retained for 30 days after cancellation, then permanently deleted.</Li>
              <Li><strong>Billing records:</strong> Retained for 7 years to comply with tax and accounting obligations.</Li>
              <Li><strong>Audit logs:</strong> Retained for 12 months.</Li>
              <Li><strong>Backups:</strong> Database backups retained for up to 30 days.</Li>
            </ul>
          </Section>

          <Section title="7. Your Rights Under GDPR">
            <P>If you are located in the EU/EEA or UK, you have the following rights:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li><strong>Right of access (Art. 15):</strong> Request a copy of your personal data.</Li>
              <Li><strong>Right to rectification (Art. 16):</strong> Correct inaccurate data — available directly in Settings → Profile.</Li>
              <Li><strong>Right to erasure (Art. 17):</strong> Request deletion of your account and personal data.</Li>
              <Li><strong>Right to data portability (Art. 20):</strong> Receive your data in a machine-readable format.</Li>
              <Li><strong>Right to restrict processing (Art. 18):</strong> Request we limit how we process your data.</Li>
              <Li><strong>Right to object (Art. 21):</strong> Object to processing based on legitimate interests.</Li>
              <Li><strong>Right to withdraw consent:</strong> Where processing is based on consent, withdraw it at any time.</Li>
            </ul>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">⚠️ Important — B2B users</p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                If you use DodoDesk as an employee or agent of a company, your employer is the <strong>data controller</strong> for your work-related data.
                Erasure and portability requests for work data (tickets you raised, assets assigned to you) should be directed to your employer first.
                DodoBay, as the <strong>data processor</strong>, will act on your employer's instructions.
                Your employer must respond to your request within 30 days. If they do not, you may contact your national data protection authority.
              </p>
            </div>
            <P>To exercise any of these rights, email <strong>privacy@dodobay.com</strong>. We will respond within 30 days. You also have the right to lodge a complaint with your local data protection authority.</P>
          </Section>

          <Section title="8. Cookies">
            <P>DodoDesk uses only <strong>essential cookies</strong> necessary for the platform to function — specifically, authentication tokens stored in your browser's localStorage. We do not use advertising, tracking, or analytics cookies.</P>
            <P>Our cookie consent banner allows you to accept or decline non-essential cookies. Since we only use essential cookies, declining has no impact on platform functionality.</P>
          </Section>

          <Section title="9. Security">
            <P>We implement industry-standard security measures including:</P>
            <ul className="list-disc list-inside mb-3 space-y-1">
              <Li>All data encrypted in transit (TLS 1.2+) and at rest</Li>
              <Li>Passwords hashed using bcrypt — never stored in plain text</Li>
              <Li>File attachments stored privately on Cloudinary with time-limited signed URLs</Li>
              <Li>Multi-factor authentication (MFA) available for all users</Li>
              <Li>Single-session enforcement to prevent concurrent access</Li>
              <Li>Role-based access control — users can only access their tenant's data</Li>
            </ul>
          </Section>

          <Section title="10. Data Breach Notification">
            <P>In the event of a personal data breach, we will notify affected users and the relevant supervisory authority within 72 hours of becoming aware, as required by GDPR Article 33.</P>
          </Section>

          <Section title="11. Children's Data">
            <P>DodoDesk is a business IT service management platform intended for use by adults in a professional context. We do not knowingly collect personal data from anyone under the age of 16.</P>
          </Section>

          <Section title="12. Changes to This Policy">
            <P>We may update this Privacy Policy from time to time. We will notify you of material changes by email or by displaying a notice within DodoDesk. The effective date at the top of this page indicates when the policy was last updated.</P>
          </Section>

          <Section title="13. Contact Us">
            <P>For any privacy-related questions, data subject requests, or to request our Data Processing Agreement (DPA), please contact:</P>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-800 dark:text-white">Data Protection Contact</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">privacy@dodobay.com</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">DodoBay Company Limited, Baptiste Lane, Terre Rouge, Mauritius</p>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
