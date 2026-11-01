import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Loading } from "@/ui/primitives";

export default function Index() {
  const { user, ready } = useAuth();

  if (!ready) return <Loading label="Starting up" />;
  return <Redirect href={user ? "/(tabs)/venues" : "/sign-in"} />;
}
