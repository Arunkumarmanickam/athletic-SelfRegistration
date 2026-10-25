import { Navigate, Route, Routes } from 'react-router-dom'
import { PaymentReturnGate } from './components/registration/PaymentReturnGate'
import { PublicLayout } from './components/layout/PublicLayout'
import { AdminLayout } from './components/layout/AdminLayout'
import { HomePage } from './pages/public/HomePage'
import { RegisterPage } from './pages/public/RegisterPage'
import { ReturningPage } from './pages/public/ReturningPage'
import { StatusPage } from './pages/public/StatusPage'
import { SuccessPage } from './pages/public/SuccessPage'
import { PrivacyPage, TermsPage, ContactPage } from './pages/public/PolicyPages'
import { NotFoundPage } from './pages/public/NotFoundPage'
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { DashboardPage } from './pages/admin/DashboardPage'
import { RegistrationsPage } from './pages/admin/RegistrationsPage'
import { RegistrationDetailPage } from './pages/admin/RegistrationDetailPage'
import { ApplicationDetailPage } from './pages/admin/ApplicationDetailPage'
import { AthletesPage } from './pages/admin/AthletesPage'
import { AthleteDetailPage } from './pages/admin/AthleteDetailPage'
import { PaymentsPage } from './pages/admin/PaymentsPage'
import { ChampionshipsPage } from './pages/admin/ChampionshipsPage'
import { AuditPage } from './pages/admin/AuditPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { SettingsPage } from './pages/admin/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route
        element={
          <PaymentReturnGate>
            <PublicLayout />
          </PaymentReturnGate>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="register/:slug" element={<RegisterPage />} />
        <Route path="returning" element={<ReturningPage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="registration/success" element={<SuccessPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="registrations" element={<RegistrationsPage />} />
        <Route path="registrations/:registrationId" element={<RegistrationDetailPage />} />
        <Route path="applications/:applicationId" element={<ApplicationDetailPage />} />
        <Route path="athletes" element={<AthletesPage />} />
        <Route path="athletes/:athleteId" element={<AthleteDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="championships" element={<ChampionshipsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  )
}
