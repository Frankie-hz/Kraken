import { useData } from "../store";

function FFXISelect() {
  const {
    folders: { getDatFolder, promptDatFolder },
  } = useData();

  return (
    <div class="setup-card">
      <div class="setup-card__header">
        <div>
          <div class="eyebrow">Source DATs</div>
          <h2>FFXI Folder</h2>
        </div>
        <div class={`status-pill ${getDatFolder() ? "is-ready" : "is-missing"}`}>
          {getDatFolder() ? "Connected" : "Required"}
        </div>
      </div>

      <p class="muted-note">
        Point Kraken at your FFXI installation so it can read the original DATs and export them into editable files.
      </p>

      <button onclick={() => promptDatFolder()}>Select FFXI folder</button>

      <div class="path-card">
        <span class="path-card__label">Current source path</span>
        <div class={`path-card__value ${getDatFolder() ? "is-ready" : "is-missing"}`}>
          {getDatFolder() ?? "No FFXI folder selected yet."}
        </div>
      </div>
    </div>
  );
}

export default FFXISelect;
