import { useData } from "../store";
import Updater from "./Updater";

function Statusbar() {
  const {
    folders: {
      getDatFolder,
      setDatFolder,
      getProjectFolder,
      setProjectFolder,
      promptDatFolder,
      promptProjectFolder,
    },
  } = useData();

  return (
    <footer class="statusbar-shell">
      <div class="statusbar-grid">
        <div class="statusbar-item">
          <span class="statusbar-label">Project</span>
          <div
            class="statusbar-path"
            onclick={(e) => {
              if (e.ctrlKey) {
                setProjectFolder(null);
              } else {
                promptProjectFolder();
              }
            }}
          >
            {getProjectFolder() ?? "No project folder selected. Click to choose one."}
          </div>
          <div class="statusbar-note">Editors save YAML to Project/Custom/Yaml/ROM... and DATs to Project/Custom/ROM...</div>
        </div>

        <div class="statusbar-item">
          <span class="statusbar-label">FFXI Source</span>
          <div
            class="statusbar-path"
            onclick={(e) => {
              if (e.ctrlKey) {
                setDatFolder(null);
              } else {
                promptDatFolder();
              }
            }}
          >
            {getDatFolder() ?? "No FFXI folder selected. Click to choose one."}
          </div>
          <div class="statusbar-note">Ctrl+click any path card here to clear it.</div>
        </div>
      </div>

      <div class="ml-auto">
        <Updater></Updater>
      </div>
    </footer>
  );
}

export default Statusbar;
