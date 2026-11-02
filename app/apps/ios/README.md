# @home/ios — iPhone shell (Capacitor)

Same UI bundle as desktop. Native project generation needs macOS + Xcode (the Mac mini):

```sh
pnpm install
pnpm --filter @home/ios add:ios        # once: generates ios/ (Xcode project)
# merge Info.plist.additions.xml into ios/App/App/Info.plist
pnpm --filter @home/ios sync           # builds @home/ui and copies it in
pnpm --filter @home/ios open           # opens Xcode → run on device
```

Token storage uses `capacitor-secure-storage-plugin` (iOS Keychain); the UI talks to it via `window.Capacitor.Plugins.SecureStoragePlugin` (see `packages/ui/src/platform.ts`).
The phone reaches HA over Tailscale (http://<omarchy-tailscale-ip>:8123), so install Tailscale on the iPhone.
