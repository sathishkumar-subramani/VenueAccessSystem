import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/lib/auth";
import { theme } from "@/lib/theme";
import { Loading } from "@/ui/primitives";

export default function TabsLayout() {
  const { user, ready } = useAuth();

  if (!ready) return <Loading label="Starting up" />;
  if (!user) return <Redirect href="/sign-in" />;

  const isOperator = user.role === "venue_operator" || user.role === "platform_admin";

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.paper },
        headerShadowVisible: false,
        headerTintColor: theme.ink,
        tabBarActiveTintColor: theme.stamp,
        tabBarInactiveTintColor: theme.inkSoft,
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.rule },
        sceneStyle: { backgroundColor: theme.paper },
      }}
    >
      <Tabs.Screen name="venues" options={{ title: "Places" }} />
      <Tabs.Screen name="passes" options={{ title: "Passes" }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Check in",
          // Door staff only. The tab is hidden rather than shown-and-refused.
          href: isOperator ? undefined : null,
        }}
      />
    </Tabs>
  );
}
