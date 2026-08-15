import { Link, router } from 'expo-router';
import { Screen } from '../../src/components/ui/Screen';
import { AuthForm } from '../../src/auth/AuthForm';
import { useAuth } from '../../src/auth/AuthContext';
import { typography } from '../../src/theme/typography';
import { colors } from '../../src/theme/colors';

export default function LoginScreen() {
  const { login } = useAuth();

  return (
    <Screen>
      <AuthForm
        submitLabel="Log in"
        onSubmit={async (email, password) => {
          await login(email, password);
          router.back();
        }}
        footer={
          <Link href="/(auth)/signup" replace style={[typography.label, { color: colors.accent }]}>
            No account? Sign up
          </Link>
        }
      />
    </Screen>
  );
}
