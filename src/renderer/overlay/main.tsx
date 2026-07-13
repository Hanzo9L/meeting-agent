import React from "react";
import { createRoot } from "react-dom/client";
import { OverlayApp } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>
);
