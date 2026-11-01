import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Button, Notice, styles } from "@/ui/primitives";

/**
 * The door. A phone at the counter is the whole hardware requirement.
 *
 * The server decides admission — this screen only carries the scanned token and
 * shows the answer. Rejections are a normal outcome here, not an error state.
 */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const busy = useRef(false);

  const onScanned = async (token: string) => {
    // Lock out repeat frames: the camera fires many times a second.
    if (busy.current) return;
    busy.current = true;

    try {
      const result = await api.operator.redeem(token);
      setOutcome({ ok: true, message: result.message });
    } catch (cause) {
      setOutcome({
        ok: false,
        message: cause instanceof Error ? cause.message : "This pass was not accepted.",
      });
    } finally {
      // Long enough for the person at the door to read the result.
      setTimeout(() => {
        busy.current = false;
      }, 2500);
    }
  };

  if (!permission) return <View style={styles.screen} />;

  if (!permission.granted) {
    return (
      <View style={styles.screen}>
        <Notice>The camera is needed to scan passes at the door.</Notice>
        <Button label="Allow camera" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={{ aspectRatio: 1, overflow: "hidden", borderWidth: 1, borderColor: theme.rule }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => void onScanned(data)}
        />
      </View>

      {outcome ? (
        <View
          style={{
            borderLeftWidth: 4,
            borderLeftColor: outcome.ok ? theme.valid : theme.void,
            paddingLeft: 14,
            paddingVertical: 12,
            backgroundColor: theme.card,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "700", color: theme.ink }}>
            {outcome.ok ? "Let them in" : "Do not admit"}
          </Text>
          <Text style={{ color: theme.inkSoft, marginTop: 4 }}>{outcome.message}</Text>
        </View>
      ) : (
        <Notice>Point the camera at the code on the visitor's screen.</Notice>
      )}
    </View>
  );
}
