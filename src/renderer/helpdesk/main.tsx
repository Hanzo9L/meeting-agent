import React from "react";
import { createRoot } from "react-dom/client";
import { HelpdeskApp } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelpdeskApp />
  </React.StrictMode>
);
