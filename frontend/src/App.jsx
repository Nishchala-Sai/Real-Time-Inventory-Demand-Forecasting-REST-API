import Dashboard from './components/Dashboard';
import LoginForm from './components/LoginForm';
import { useAuth } from './hooks/useAuth';

export default function App() {
  const { user, loading, login, logout } = useAuth();

  if (loading) return <p className="dashboard-container">Loading…</p>;
  if (!user) return <LoginForm onLogin={login} />;
  return <Dashboard user={user} onLogout={logout} />;
}
