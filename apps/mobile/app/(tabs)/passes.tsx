import { FlatList, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Loading, Notice, styles } from "@/ui/primitives";

export default function PassesScreen() {
  const passes = useQuery({ queryKey: ["passes"], queryFn: () => api.passes.mine() });

  if (passes.isPending) return <Loading label="Loading your passes" />;

  if (passes.data?.length === 0) {
    return (
      <View style={styles.screen}>
        <Notice>No passes yet. Pick a place and buy one — it shows up here straight away.</Notice>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={passes.data ?? []}
        keyExtractor={(pass) => pass.id}
        contentContainerStyle={{ gap: 12 }}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/pass/${item.id}`)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.ink }}>
                  {item.venueName}
                </Text>
                <Text style={{ fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
                  until {new Date(item.validUntil).toLocaleString("en-IN")}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  color: item.state === "active" ? theme.valid : theme.inkSoft,
                }}
              >
                {item.state}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
