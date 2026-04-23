import { useData } from "../store";

function CustomDatRootSelect() {
  const {
    folders: { getLocalEditFolder, promptLocalEditFolder },
  } = useData();

  return (
    <div class="setup-card">
      <div class="setup-card__header">
        <div>
          <div class="eyebrow">Output root</div>
          <h2>Custom DAT Root</h2>
        </div>
        <div class={`status-pill ${getLocalEditFolder() ? "is-ready" : "is-missing"}`}>
          {getLocalEditFolder() ? "Optional set" : "Optional"}
        </div>
      </div>

      <p class="muted-note">
        Use this when you want editor tools to auto-save YAML under `Yaml/ROM...` and generated DATs under `ROM...`
        inside a dedicated mod or output tree.
      </p>

      <button onclick={() => promptLocalEditFolder()}>
        Select custom DAT root
      </button>

      <div class="path-card">
        <span class="path-card__label">Current output path</span>
        <div class={`path-card__value ${getLocalEditFolder() ? "is-ready" : "is-missing"}`}>
          {getLocalEditFolder() ?? "No custom DAT root selected yet."}
        </div>
      </div>
    </div>
  );
}

export default CustomDatRootSelect;
