/* @refresh reload */
import { render } from "solid-js/web";

import "./vite_import_meta.d.ts"

import "./index.css";
import App from "./App";
import { Router } from "@solidjs/router";
import { DataProvider } from "./store";
import { AppDialogHost } from "./dialogs";

render(
  () => (
    <DataProvider>
      <Router>
        <App />
        <AppDialogHost />
      </Router>
    </DataProvider>
  ),
  document.getElementById("root") as HTMLElement
);
