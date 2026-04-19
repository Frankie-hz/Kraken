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
    <footer class="flex bg-slate-900 border-t border-t-slate-400 text-slate-100 justify-start p-1 text-sm">
      <div class="flex w-full h-full items-center">
        <div
          class="items-center grid"
          style={"grid-template-columns: max-content max-content; height: min-content"}
        >
          <div class="px-1 text-right whitespace-nowrap">Project:</div>

          <div
            class="cursor-pointer"
            onclick={(e) => {
              if (e.ctrlKey) {
                setProjectFolder(null);
              } else {
                promptProjectFolder();
              }
            }}
          >
            {getProjectFolder() ? (
              <div class="text-green-200">{getProjectFolder()}</div>
            ) : (
              <div class="underline text-red-200">
                None. Click to select one.
              </div>
            )}
          </div>
          <div class="px-1 text-right whitespace-nowrap">FFXI:</div>
          <div
            class="cursor-pointer"
            onclick={(e) => {
              if (e.ctrlKey) {
                setDatFolder(null);
              } else {
                promptDatFolder();
              }
            }}
          >
            {getDatFolder() ? (
              <div class="text-green-200">{getDatFolder()}</div>
            ) : (
              <div class="underline text-red-200">
                None. Click here to select.
              </div>
            )}
          </div>
          <div class="px-1 text-right whitespace-nowrap" title={CUSTOM_DAT_ROOT_HELP}>
            Custom DAT Root:
          </div>
          <div
            class="cursor-pointer"
            title={CUSTOM_DAT_ROOT_HELP}
            onclick={(e) => {
              if (e.ctrlKey) {
                setLocalEditFolder(null);
              } else {
                promptLocalEditFolder();
              }
            }}
          >
            {getLocalEditFolder() ? (
              <div class="text-green-200">{getLocalEditFolder()}</div>
            ) : (
              <div class="underline text-red-200">
                None. Click here to select.
              </div>
            )}
          </div>
        </div>
        <div class="flex-grow"></div>
        <Updater></Updater>
      </div>
    </footer>
  );
}

export default Statusbar;
