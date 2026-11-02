import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles.css";
import "./light.css";
import { App } from "./App";
import { loadConfig } from "./platform";

void loadConfig().then((cfg) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App initial={cfg} />
    </StrictMode>,
  );
});
