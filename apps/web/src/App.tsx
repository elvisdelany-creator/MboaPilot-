import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LoginPage } from "@/components/auth/LoginPage";
import { CaissePage } from "@/components/caisse/CaissePage";

function Contenu() {
  const { session } = useAuth();
  return session ? <CaissePage /> : <LoginPage />;
}

function App() {
  return (
    <AuthProvider>
      <Contenu />
      <Toaster />
    </AuthProvider>
  );
}

export default App;
