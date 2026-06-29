import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider } from './i18n/I18nContext';
import { ToastProvider } from './contexts/ToastContext';
import { BrandingProvider } from './contexts/BrandingContext';
import Login from './pages/Login';
import Signup from './pages/Signup';
import VerifyEmail from './pages/VerifyEmail';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import RefundPolicy from './pages/RefundPolicy';
import CookieBanner from './CookieBanner';
import ChatWidget from './ChatWidget';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import CreateTicket from './pages/CreateTicket';
import TicketDetail from './pages/TicketDetail';
import KbList from './pages/KbList';
import KbArticle from './pages/KbArticle';
import CreateKbArticle from './pages/CreateKbArticle';
import AssetList from './pages/AssetList';
import AssetDetail from './pages/AssetDetail';
import CreateAsset from './pages/CreateAsset';
import Reports from './pages/Reports';
import AuditLog from './pages/AuditLog';
import AdminUsers from './pages/AdminUsers';
import EditUser from './pages/EditUser';
import CannedResponses from './pages/CannedResponses';
import ChangeList from './pages/ChangeList';
import ChangeDetail from './pages/ChangeDetail';
import CreateChange from './pages/CreateChange';
import Settings from './pages/Settings';
import ServiceCatalog from './pages/ServiceCatalog';
import CsatSurvey from './pages/CsatSurvey';
import ApprovalWorkflows from './pages/ApprovalWorkflows';
import Groups from './pages/Groups';
import AutomationRules from './pages/AutomationRules';
import CreateUser from './pages/CreateUser';
import Macros from './pages/Macros';
import TicketTemplatesPage from './pages/TicketTemplatesPage';
import NotFound from './NotFound';

function ProtectedRoute({ children }) {
  const { token, isLoading } = useAuth();
  if (isLoading === true) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }
  return token ? children : <Navigate to="/login" />;
}

function AuthRoute({ children }) {
  // Redirect already-authenticated users away from /login and /signup
  const { token, isLoading } = useAuth();
  if (isLoading === true) return null;
  return token ? <Navigate to="/" /> : children;
}

function AppRoutes() {
  const { user } = useAuth();
  const lang = user?.language || 'en';
  const theme = user?.theme || 'light';

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  return (
    <I18nProvider initialLang={lang}>
      <ToastProvider>
        <BrandingProvider>
          <Routes>
            <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
            <Route path="/signup" element={<AuthRoute><Signup /></AuthRoute>} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/refunds" element={<RefundPolicy />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/create-ticket" element={<ProtectedRoute><CreateTicket /></ProtectedRoute>} />
            <Route path="/tickets/:id" element={<ProtectedRoute><TicketDetail /></ProtectedRoute>} />
            <Route path="/kb" element={<ProtectedRoute><KbList /></ProtectedRoute>} />
            <Route path="/kb/new" element={<ProtectedRoute><CreateKbArticle /></ProtectedRoute>} />
            <Route path="/kb/:id" element={<ProtectedRoute><KbArticle /></ProtectedRoute>} />
            <Route path="/assets" element={<ProtectedRoute><AssetList /></ProtectedRoute>} />
            <Route path="/assets/new" element={<ProtectedRoute><CreateAsset /></ProtectedRoute>} />
            <Route path="/assets/:id" element={<ProtectedRoute><AssetDetail /></ProtectedRoute>} />
            <Route path="/changes" element={<ProtectedRoute><ChangeList /></ProtectedRoute>} />
            <Route path="/changes/new" element={<ProtectedRoute><CreateChange /></ProtectedRoute>} />
            <Route path="/changes/:id" element={<ProtectedRoute><ChangeDetail /></ProtectedRoute>} />
            <Route path="/canned-responses" element={<ProtectedRoute><CannedResponses /></ProtectedRoute>} />
            <Route path="/macros" element={<ProtectedRoute><Macros /></ProtectedRoute>} />
            <Route path="/ticket-templates" element={<ProtectedRoute><TicketTemplatesPage /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/audit-log" element={<ProtectedRoute><AuditLog /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/users/new" element={<ProtectedRoute><CreateUser /></ProtectedRoute>} />
            <Route path="/admin/users/:id/edit" element={<ProtectedRoute><EditUser /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/catalog" element={<ProtectedRoute><ServiceCatalog /></ProtectedRoute>} />
            <Route path="/workflows" element={<ProtectedRoute><ApprovalWorkflows /></ProtectedRoute>} />
            <Route path="/groups" element={<ProtectedRoute><Groups /></ProtectedRoute>} />
            <Route path="/automation" element={<ProtectedRoute><AutomationRules /></ProtectedRoute>} />
            <Route path="/csat/:token" element={<CsatSurvey />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <CookieBanner />
          <ChatWidget />
        </BrandingProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;