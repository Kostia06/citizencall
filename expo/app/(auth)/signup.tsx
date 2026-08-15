import { Link, router } from 'expo-router';
import { Screen } from '../../src/components/ui/Screen';
import { AuthForm } from '../../src/auth/AuthForm';
import { useAuth } from '../../src/auth/AuthContext';
import { typography } from '../../src/theme/typography';
import { colors } from '../../src/theme/colors';

export default function SignupScreen() {
  const { signup } = useAuth();

  return (
    <Screen>
      <AuthForm
        submitLabel="Create account"
        onSubmit={async (email, password) => {
          await signup(email, password);
          router.back();
        }}
        footer={
          <Link href="/(auth)/login" replace style={[typography.label, { color: colors.accent }]}>
            Already have an account? Log in
          </Link>
        }
      />
    </Screen>
  );
}
