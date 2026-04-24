import { For, Show, createSignal } from "solid-js";
import { useData } from "../store";

function ProjectSelect() {
  const {
    folders: {
      getRecentProjectFolders,
      getProjectFolder,
      setProjectFolder,
      promptProjectFolder,
    },
  } = useData();

  const [isLoading, setLoading] = createSignal(false);

  const updateFolder = async (folder: string | null) => {
    setLoading(true);
    await setProjectFolder(folder);
    setLoading(false);
  };

  return (
    <div class="setup-card">
      <div class="setup-card__header">
        <div>
          <div class="eyebrow">Workspace</div>
          <h2>Project Folder</h2>
        </div>
        <div class={`status-pill ${getProjectFolder() ? "is-ready" : "is-missing"}`}>
          {getProjectFolder() ? "Connected" : "Required"}
        </div>
      </div>

      <p class="muted-note">
        Point this to your working project folder. Kraken saves editor YAML under `Yaml/ROM...`, generated DATs under
        `ROM...`, and uses the same base for regeneration workflows.
      </p>

      <button onclick={() => promptProjectFolder()}>
        Select project folder
      </button>

      <div class="path-card">
        <span class="path-card__label">Current project path</span>
        <div class={`path-card__value ${getProjectFolder() ? "is-ready" : "is-missing"}`}>
          {getProjectFolder() ?? "No project folder selected yet."}
          <Show when={isLoading()}>
            <span class="helper-text"> Loading...</span>
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="path-card__label">Recent project folders</span>
        <ul class="recent-list">
          <For each={getRecentProjectFolders()} fallback={<li class="helper-text">No recent projects yet.</li>}>
            {(recentProject) => (
              <li class="recent-item" onclick={() => updateFolder(recentProject)}>
                {recentProject}
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}

export default ProjectSelect;
