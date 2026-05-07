import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './app/auth/AuthProvider';
import ProtectedRoute from './app/auth/ProtectedRoute';
import LoginPage from './app/auth/LoginPage';
import FieldPage from './app/FieldPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <FieldPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
