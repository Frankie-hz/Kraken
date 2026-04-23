import { useData } from "../store";
import Updater from "./Updater";

const CUSTOM_DAT_ROOT_HELP =
  "Used by editor tools as the auto-save base path. YAML files are saved to Custom DAT Root/Yaml/ROM... and DAT files to Custom DAT Root/ROM...";

function Statusbar() {
  const {
    folders: {
      getDatFolder,
      setDatFolder,
      getProjectFolder,
      setProjectFolder,
      getLocalEditFolder,
      setLocalEditFolder,
      promptDatFolder,
      promptProjectFolder,
      promptLocalEditFolder,
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
        </div>

        <div class="statusbar-item" title={CUSTOM_DAT_ROOT_HELP}>
          <span class="statusbar-label">Custom DAT Root</span>
          <div
            class="statusbar-path"
            title={CUSTOM_DAT_ROOT_HELP}
            onclick={(e) => {
              if (e.ctrlKey) {
                setLocalEditFolder(null);
              } else {
                promptLocalEditFolder();
              }
            }}
          >
            {getLocalEditFolder() ?? "Optional. Click to choose a DAT output root."}
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
