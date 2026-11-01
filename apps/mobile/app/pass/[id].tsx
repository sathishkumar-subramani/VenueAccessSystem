import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Loading, Notice, styles } from "@/ui/primitives";

export default function PassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const passId = String(id);

  const pass = useQuery({ queryKey: ["pass", passId], queryFn: () => api.passes.byId(passId) });
  const isActive = pass.data?.state === "active";

  /**
   * The QR holds a token that lives about 30 seconds, refetched while this
   * screen is open. A screenshot sent to a friend is dead before they arrive.
   */
  const token = useQuery({
    queryKey: ["pass-token", passId],
    queryFn: () => api.passes.token(passId),
    enabled: isActive,
    refetchInterval: 25_000,
    gcTime: 0,
  });

  if (pass.isPending) return <Loading label="Loading your pass" />;
  if (!pass.data) {
    return (
      <View style={styles.screen}>
        <Notice tone="error">We could not find that pass.</Notice>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.card, { padding: 0 }]}>
        <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: theme.rule }}>
          <Text style={styles.subheading}>ADMIT ONE</Text>
          <Text style={{ fontSize: 20, fontWeight: "700", color: theme.ink, marginTop: 4 }}>
            {pass.data.venueName}
          </Text>
        </View>

        <View style={{ alignItems: "center", gap: 16, paddingVertical: 32 }}>
          {!isActive ? (
            <Text style={{ color: theme.void, textTransform: "uppercase", letterSpacing: 1 }}>
              {pass.data.state}
            </Text>
          ) : token.data ? (
            <QRCode value={token.data.token} size={210} backgroundColor={theme.card} />
          ) : (
            <View style={{ height: 210, justifyContent: "center" }}>
              <ActivityIndicator color={theme.inkSoft} />
            </View>
          )}

          <Text style={{ color: theme.inkSoft, fontSize: 12, textAlign: "center", paddingHorizontal: 24 }}>
            {isActive
              ? "Show this at the door. The code refreshes on its own."
              : "This pass can no longer be scanned."}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            borderTopWidth: 1,
            borderTopColor: theme.rule,
            padding: 16,
            gap: 24,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.inkSoft, fontSize: 11 }}>ENTRIES LEFT</Text>
            <Text style={{ color: theme.ink, fontSize: 16, fontVariant: ["tabular-nums"] }}>
              {pass.data.entriesRemaining}
            </Text>
          </View>
          <View style={{ flex: 2 }}>
            <Text style={{ color: theme.inkSoft, fontSize: 11 }}>VALID UNTIL</Text>
            <Text style={{ color: theme.ink, fontSize: 16 }}>
              {new Date(pass.data.validUntil).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
