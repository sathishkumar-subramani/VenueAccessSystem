import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { theme } from "../lib/theme";

export function Button({
  label,
  onPress,
  disabled,
  variant = "solid",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "solid" | "quiet";
}) {
  const solid = variant === "solid";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        solid ? styles.buttonSolid : styles.buttonQuiet,
        (pressed || disabled) && styles.buttonDimmed,
      ]}
    >
      <Text style={solid ? styles.buttonSolidLabel : styles.buttonQuietLabel}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        {...props}
        style={styles.input}
        placeholderTextColor={theme.inkSoft}
        autoCapitalize="none"
      />
    </View>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "good"; children: ReactNode }) {
  const color = tone === "error" ? theme.void : tone === "good" ? theme.valid : theme.rule;
  const textColor = tone === "error" ? theme.void : tone === "good" ? theme.valid : theme.inkSoft;

  return (
    <View style={[styles.notice, { borderLeftColor: color }]}>
      <Text style={[styles.noticeText, { color: textColor }]}>{children}</Text>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.inkSoft} />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper, padding: 20, gap: 16 },
  button: { paddingVertical: 14, paddingHorizontal: 18, alignItems: "center" },
  buttonSolid: { backgroundColor: theme.ink },
  buttonQuiet: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.rule },
  buttonDimmed: { opacity: 0.6 },
  buttonSolidLabel: { color: theme.paper, fontWeight: "600", fontSize: 15 },
  buttonQuietLabel: { color: theme.ink, fontWeight: "600", fontSize: 15 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 11, letterSpacing: 1, color: theme.inkSoft },
  input: {
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.ink,
  },
  notice: { borderLeftWidth: 2, paddingLeft: 12, paddingVertical: 8 },
  noticeText: { fontSize: 14 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingLabel: { color: theme.inkSoft, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: "700", color: theme.ink },
  subheading: { fontSize: 12, letterSpacing: 2, color: theme.inkSoft },
  mono: { fontFamily: undefined, fontVariant: ["tabular-nums"], color: theme.ink },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.rule, padding: 16 },
});
