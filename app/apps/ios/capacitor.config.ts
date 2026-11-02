import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iPhone shell: wraps the exact same @home/ui build. HA runs over plain http on
 * the tailnet, so the WKWebView is served from http://localhost (no mixed
 * content) and ATS gets a local-networking exception in Info.plist (see README).
 */
const config: CapacitorConfig = {
  appId: "no.owner.home",
  appName: "Home",
  webDir: "../../packages/ui/dist",
  backgroundColor: "#06080d",
  server: { iosScheme: "http", hostname: "localhost" },
  ios: { contentInset: "never", scheme: "Home", limitsNavigationsToAppBoundDomains: false },
};

export default config;
