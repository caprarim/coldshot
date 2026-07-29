import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import MainWindow from "./views/MainWindow";
import Overlay from "./views/Overlay";
import Editor from "./views/Editor";
import Pin from "./views/Pin";
import Preview from "./views/Preview";

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "main";

function App() {
  if (view === "overlay") return <Overlay />;
  if (view === "editor") return <Editor id={params.get("id") ?? ""} />;
  if (view === "preview") return <Preview id={params.get("id") ?? ""} />;
  if (view === "pin") return <Pin pid={params.get("pid") ?? ""} />;
  return <MainWindow />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
