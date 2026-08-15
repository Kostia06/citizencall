import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TextField } from '../components/ui/TextField';
import { Button } from '../components/ui/Button';
import { colors } from '../theme/colors';
import { spacing, typography } from '../theme/typography';

interface AuthFormProps {
  submitLabel: string;
  onSubmit(email: string, password: string): Promise<void>;
  footer?: ReactNode;
}

/** Shared email/password form for login + signup — both screens only differ
 * in copy and which `authApi` call they wire up (AuthContext.login/signup),
 * so the form itself is one component. */
export function AuthForm({ submitLabel, onSubmit, footer }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.form}>
      <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 12 characters" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={submitLabel} onPress={handleSubmit} loading={submitting} disabled={!email || !password} />
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, padding: spacing.lg },
  error: { ...typography.label, color: colors.danger },
});
