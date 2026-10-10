import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./index.css";
import "./styles/sbd.css";
import { BRAND_TOKENS } from "@shared/brand";
import { primeLocation } from "@/lib/location";

for (const [name, value] of Object.entries(BRAND_TOKENS)) document.documentElement.style.setProperty(name, value);
void primeLocation();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
