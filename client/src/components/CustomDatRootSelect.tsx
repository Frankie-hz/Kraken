import { useData } from "../store";

function CustomDatRootSelect() {
  const {
    folders: { getLocalEditFolder, promptLocalEditFolder },
  } = useData();

  return (
    <div>
      <h2>Custom DAT Root</h2>
      <i>
        This should point to your custom DAT output root.
        Editor tools use this as the base save location and will auto-write YAML to `Yaml/ROM...`
        and DAT to `ROM...`.
      </i>

      <div>
        <button onclick={() => promptLocalEditFolder()}>
          Select a custom DAT root
        </button>
        <div>
          Current custom DAT root:
          {getLocalEditFolder() ? (
            <span class="text-green-200 px-2">{getLocalEditFolder()}</span>
          ) : (
            <span class="text-red-200 px-2">None</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default CustomDatRootSelect;
