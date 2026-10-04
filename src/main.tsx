import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource/roboto/latin-300.css";
import "@fontsource/roboto/latin-300-italic.css";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "@fontsource/roboto/latin-400-italic.css";
import "@fontsource/roboto/latin-700-italic.css";
import "@fontsource/lato/latin-400.css";
import "@fontsource/lato/latin-700.css";
import "@fontsource/lato/latin-400-italic.css";
import "@fontsource/lato/latin-700-italic.css";
import "@fontsource/caveat/latin-400.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/itim/latin-400.css";
import "@fontsource/gaegu/latin-400.css";
import "@fontsource/gaegu/latin-700.css";
import "@fontsource/gochi-hand/latin-400.css";
import "./styles.css";
Object.assign(window, { EXCALIDRAW_ASSET_PATH: "/excalidraw/" });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
