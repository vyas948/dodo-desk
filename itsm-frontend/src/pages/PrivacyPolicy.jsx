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
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">DodoBay Ltd — DodoDesk</p>
            <h1 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">Privacy Policy</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Effective date: June 16, 2025 &nbsp;·&nbsp; Contact: contact@dodobay.com</p>
          </div>

          <Section title="1. Introduction">
            <P>DodoBay Ltd ("we", "us", or "our") operates the DodoDesk platform, an IT Service Management (ITSM) SaaS product. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our services.</P>
            <P>By using DodoDesk, you agree to the collection and use of information in accordance with this policy.</P>
          </Section>

          <Section title="2. Information We Collect">
            <P>We collect the following categories of information:</P>
            <ul className="list-disc list-inside space-y-1 mb-3 ml-2">
              <Li>Account information: your name, work email address, company name, and password (stored as a secure hash)</Li>
              <Li>Profile information: job title, department, profile photo (optional)</Li>
              <Li>Usage data: tickets, assets, knowledge base articles, and other content you create within the platform</Li>
              <Li>Technical data: IP addresses, browser type, device identifiers, log files, and session identifiers</Li>
              <Li>Payment information: handled entirely by Paddle (our payment processor). We do not store card numbers or payment credentials</Li>
              <Li>Communications: emails you send to our support team</Li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Information">
            <P>We use collected information to:</P>
            <ul className="list-disc list-inside space-y-1 mb-3 ml-2">
              <Li>Provide, operate, and maintain the DodoDesk platform</Li>
              <Li>Process subscription payments via Paddle</Li>
              <Li>Send transactional emails (account verification, ticket notifications, password resets)</Li>
              <Li>Respond to support requests and enquiries</Li>
              <Li>Monitor platform performance, security, and reliability</Li>
              <Li>Comply with legal obligations</Li>
            </ul>
            <P>We do not sell your personal data to third parties. We do not use your data for advertising purposes.</P>
          </Section>

          <Section title="4. Data Storage and Security">
            <P>Your data is stored on cloud infrastructure (Neon PostgreSQL, Render, Vercel, and Cloudinary). We implement industry-standard security measures including encrypted connections (HTTPS/TLS), bcrypt password hashing, optional two-factor authentication, session management with automatic logout, and account lockout after failed login attempts.</P>
          </Section>

          <Section title="5. Multi-Tenancy and Data Isolation">
            <P>DodoDesk is a multi-tenant platform. Each client organisation has its own isolated data workspace. One tenant cannot access another tenant's data.</P>
          </Section>

          <Section title="6. Third-Party Services">
            <P>We use the following third-party services:</P>
            <ul className="list-disc list-inside space-y-1 mb-3 ml-2">
              <Li>Paddle — payment processing and subscription management</Li>
              <Li>Neon — PostgreSQL database hosting</Li>
              <Li>Render — backend API hosting</Li>
              <Li>Vercel — frontend hosting</Li>
              <Li>Cloudinary — image and file storage</Li>
            </ul>
          </Section>

          <Section title="7. Cookies">
            <P>DodoDesk uses minimal browser storage. We use localStorage to maintain your login session token. We do not use tracking, advertising, or analytics cookies.</P>
          </Section>

          <Section title="8. Data Retention">
            <P>We retain your account data for as long as your account is active. If you close your account, we will delete or anonymise your data within 90 days, unless required by law to retain it longer.</P>
          </Section>

          <Section title="9. Your Rights">
            <P>You may have the right to access, correct, delete, or export your personal data. To exercise any of these rights, please contact us at contact@dodobay.com. We will respond within 30 days.</P>
          </Section>

          <Section title="10. Children's Privacy">
            <P>DodoDesk is not directed at children under the age of 16. We do not knowingly collect personal data from children under 16.</P>
          </Section>

          <Section title="11. Changes to This Policy">
            <P>We may update this Privacy Policy from time to time. We will notify you of material changes by email or by posting a notice in the platform.</P>
          </Section>

          <Section title="12. Contact Us">
            <P>If you have questions about this Privacy Policy, please contact us:</P>
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
