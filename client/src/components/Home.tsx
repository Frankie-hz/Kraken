import { commands } from "../bindings";
import { useData } from "../store";
import { unwrap } from "../util";
import krakenBanner from "../assets/krakenbanner.png";

function Home() {
  const {
    processing: { totalProcessingCount },
  } = useData();

  return (
    <div class="page-shell">
      <section class="hero-panel">
        <div class="hero-banner-stage">
          <img alt="Kraken" class="hero-banner-stage__image" src={krakenBanner} />
        </div>

        <div class="hero-panel__copy">
          <h1>Edit FFXI DATs directly!</h1>
          <p>
            Kraken keeps the structured parsing foundation from the original project, but re-centers the experience
            around editing, validation, and comparison tools.
          </p>

          <div class="hero-panel__actions">
            <button
              disabled={totalProcessingCount() > 0}
              onclick={() =>
                totalProcessingCount() == 0 ? commands.makeAllDats() : undefined
              }
            >
              Build all DATs
            </button>
            <button onclick={async () => unwrap(await commands.copyLookupTables())}>
              Copy lookup tables
            </button>
          </div>
        </div>

        <aside class="hero-panel__aside edit-workflow-card">
          <div>
            <div class="eyebrow">DAT translation</div>
            <h2>Decode and Encode</h2>
          </div>

          <p class="muted-note">
            Kraken translates between the binary DAT files the game uses and readable YAML files you can edit.
          </p>

          <div class="workflow-list">
            <div class="workflow-item">
              <span class="workflow-item__label">Decode</span>
              <span>
                Reads a DAT from the selected source and writes structured YAML. This is how the editor gets names,
                flags, stats, spell data, and other fields into a readable form.
              </span>
            </div>
            <div class="workflow-item">
              <span class="workflow-item__label">Edit</span>
              <span>
                The edit tools change the YAML-backed values instead of asking you to work directly inside the raw DAT
                bytes.
              </span>
            </div>
            <div class="workflow-item">
              <span class="workflow-item__label">Encode</span>
              <span>
                Saves rebuild the DAT from the current edited values, then write the matching DAT and YAML outputs into
                your project.
              </span>
            </div>
          </div>
        </aside>

        <aside class="hero-panel__aside edit-workflow-card">
          <div>
            <div class="eyebrow">Edit tool folders</div>
            <h2>Retail Base and Custom</h2>
          </div>

          <p class="muted-note">
            The edit tools use a simple two-folder version model so your retail FFXI install stays untouched.
          </p>

          <div class="workflow-list">
            <div class="workflow-item">
              <span class="workflow-item__label">Retail Base</span>
              <span>
                The base buttons copy clean DATs from your FFXI source folder into <code>Retail Base</code>. Normal saves
                do not write here.
              </span>
            </div>
            <div class="workflow-item">
              <span class="workflow-item__label">Custom</span>
              <span>
                Editor saves write changed DATs and YAML into <code>Custom</code>, keeping your edited files separate from
                the base copy.
              </span>
            </div>
            <div class="workflow-item">
              <span class="workflow-item__label">Loading</span>
              <span>
                Editors load the <code>Custom</code> version when it exists, otherwise they fall back to
                <code> Retail Base</code>.
              </span>
            </div>
            <div class="workflow-item">
              <span class="workflow-item__label">Reset</span>
              <span>
                Reset to Retail Base replaces the current <code>Custom</code> DATs with the matching files from
                <code> Retail Base</code>.
              </span>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

export default Home;
