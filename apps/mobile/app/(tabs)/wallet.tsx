import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Button, Notice, styles } from "@/ui/primitives";
import { useAuth } from "@/lib/auth";

const PACKS = [100, 500, 1000];

export default function WalletScreen() {
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const balance = useQuery({ queryKey: ["balance"], queryFn: () => api.wallet.balance() });
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: () => api.wallet.ledger() });

  const topUp = useMutation({
    mutationFn: (credits: number) => api.wallet.startTopUp(credits),
    onSuccess: () => {
      // In a shipped build this hands the order to react-native-razorpay.
      // Credits still arrive only when the signed webhook reaches the server.
      setMessage({ tone: "info", text: "Payment started. Credits land once it clears." });
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (cause: unknown) =>
      setMessage({
        tone: "error",
        text: cause instanceof Error ? cause.message : "The top-up could not be started.",
      }),
  });

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.subheading}>BALANCE</Text>
        <Text style={{ fontSize: 44, fontWeight: "700", color: theme.ink, fontVariant: ["tabular-nums"] }}>
          {balance.isPending ? "—" : (balance.data?.credits ?? 0).toLocaleString("en-IN")}
          <Text style={{ fontSize: 16, color: theme.inkSoft }}> cr</Text>
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {PACKS.map((pack) => (
          <View key={pack} style={{ flex: 1 }}>
            <Button
              label={`+${pack}`}
              variant="quiet"
              onPress={() => topUp.mutate(pack)}
              disabled={topUp.isPending}
            />
          </View>
        ))}
      </View>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Text style={{ fontSize: 16, fontWeight: "700", color: theme.ink, marginTop: 8 }}>Activity</Text>

      <FlatList
        data={ledger.data ?? []}
        keyExtractor={(entry) => entry.id}
        ListEmptyComponent={<Notice>Nothing yet. Add credits to buy your first pass.</Notice>}
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.rule,
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.ink, fontSize: 14 }}>{item.reason}</Text>
              <Text style={{ color: theme.inkSoft, fontSize: 11, marginTop: 2 }}>
                {new Date(item.occurredAt).toLocaleString("en-IN")}
              </Text>
            </View>
            <Text
              style={{
                color: item.signed < 0 ? theme.ink : theme.valid,
                fontVariant: ["tabular-nums"],
              }}
            >
              {item.signed > 0 ? "+" : ""}
              {item.signed}
            </Text>
          </View>
        )}
      />

      <Button label="Sign out" variant="quiet" onPress={() => void signOut()} />
    </View>
  );
}
