import ProjectSelect from "./ProjectSelect";
import FFXISelect from "./FFXISelect";
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
      </section>

      <section class="dashboard-grid">
        <FFXISelect />
        <ProjectSelect />
      </section>
    </div>
  );
}

export default Home;
