import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import "./ui/styles.css";
// After the base sheet, never before: the skin is a set of overrides scoped to
// `:root[data-skin="playground"]`, and it has to win on equal specificity.
import "./ui/skins/playground.css";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element to mount into");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
