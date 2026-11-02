import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("homeBridge", {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke("home:get-config"),
  setConfig: (cfg: unknown) => ipcRenderer.invoke("home:set-config", cfg),
});
