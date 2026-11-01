import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Button, Field, Notice, styles } from "@/ui/primitives";
import { theme } from "@/lib/theme";

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      if (mode === "signup") await signUp(email, password, displayName);
      else await signIn(email, password);
      router.replace("/(tabs)/venues");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.screen, { justifyContent: "center", flexGrow: 1 }]}>
      <View style={{ gap: 6, marginBottom: 12 }}>
        <Text style={styles.subheading}>VENUE ACCESS</Text>
        <Text style={[styles.heading, { fontSize: 30, lineHeight: 36 }]}>
          Load credits once.{"\n"}Walk into anywhere.
        </Text>
      </View>

      {mode === "signup" && (
        <Field label="Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      )}

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
      />

      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
      />

      {error && <Notice tone="error">{error}</Notice>}

      <Button
        label={busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
        onPress={() => void submit()}
        disabled={busy}
      />

      <Pressable
        onPress={() => {
          setMode(mode === "signup" ? "signin" : "signup");
          setError(null);
        }}
      >
        <Text style={{ textAlign: "center", color: theme.inkSoft, fontSize: 14 }}>
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
