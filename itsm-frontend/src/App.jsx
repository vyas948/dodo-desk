import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider } from './i18n/I18nContext';
import { ToastProvider } from './contexts/ToastContext';
import { BrandingProvider } from './contexts/BrandingContext';
import Login from './pages/Login';
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
import AdminUsers from './pages/AdminUsers';
import AdminTenants from './pages/AdminTenants';
import EditUser from './pages/EditUser';
import CannedResponses from './pages/CannedResponses';
import ChangeList from './pages/ChangeList';
import ChangeDetail from './pages/ChangeDetail';
import CreateChange from './pages/CreateChange';
import Settings from './pages/Settings';
import ServiceCatalog from './pages/ServiceCatalog';
import CsatSurvey from './pages/CsatSurvey';
import ApprovalWorkflows from './pages/ApprovalWorkflows';
import CreateUser from './pages/CreateUser';

function ProtectedRoute({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" />;
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
            <Route path="/login" element={<Login />} />
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
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/users/new" element={<ProtectedRoute><CreateUser /></ProtectedRoute>} />
            <Route path="/admin/users/:id/edit" element={<ProtectedRoute><EditUser /></ProtectedRoute>} />
            <Route path="/admin/tenants" element={<ProtectedRoute><AdminTenants /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/catalog" element={<ProtectedRoute><ServiceCatalog /></ProtectedRoute>} />
            <Route path="/workflows" element={<ProtectedRoute><ApprovalWorkflows /></ProtectedRoute>} />
            <Route path="/csat/:token" element={<CsatSurvey />} />
          </Routes>
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