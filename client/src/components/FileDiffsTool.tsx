import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "@solidjs/router";
import { For, Show, createEffect, createSignal } from "solid-js";
import { FolderDiffResult, compareEntityNameFolders } from "../custom_bindings";
import { showMessage } from "../dialogs";
import { useData } from "../store";
import { unwrap } from "../util";

const compactButtonBaseClass = "my-0 px-1.5 py-0.5 text-xs font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
function compactButtonClass() {
  return `${compactButtonBaseClass} ${compactButtonIdleClass}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function defaultCustomFolderFromRoot(root: string | null): string | null {
  if (!root) {
    return null;
  }
  return normalizePath(root);
}

function defaultOldRetailFolderFromRoot(root: string | null): string | null {
  if (!root) {
    return null;
  }
  return `${normalizePath(root)}/Old Retail`;
}

function formatRelativePathForDisplay(path: string) {
  return path
    .split("/")
    .map((segment) => (/^rom\d*$/i.test(segment) ? segment.toUpperCase() : segment))
    .join("/");
}

const FILE_DIFFS_STATE_KEY = "xi_tinkerer_file_diffs_state_v1";

interface FileDiffsCachedState {
  custom_folder: string;
  old_retail_folder: string;
  show_unchanged: boolean;
  last_notice: string;
  result: FolderDiffResult | null;
}

function loadCachedState(): FileDiffsCachedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(FILE_DIFFS_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as FileDiffsCachedState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function FileDiffsTool() {
  const {
    folders: { getDatFolder, getProjectFolder },
  } = useData();
  const navigate = useNavigate();
  const cachedState = loadCachedState();
  const cachedResult = (() => {
    const result = cachedState?.result;
    if (!result) {
      return null;
    }

    if (!Array.isArray((result as Partial<FolderDiffResult>).all_files)) {
      return {
        ...result,
        all_files: result.changed_files ?? [],
      } as FolderDiffResult;
    }

    return result;
  })();

  const projectRoot = getProjectFolder();
  const initialCustomDefault = defaultCustomFolderFromRoot(projectRoot);
  const initialOldRetailDefault = defaultOldRetailFolderFromRoot(projectRoot);

  const [customFolder, setCustomFolder] = createSignal(
    cachedState?.custom_folder ?? initialCustomDefault ?? "",
  );
  const [oldRetailFolder, setOldRetailFolder] = createSignal(
    cachedState?.old_retail_folder ?? initialOldRetailDefault ?? "",
  );
  const [showUnchanged, setShowUnchanged] = createSignal(cachedState?.show_unchanged ?? false);

  const [isComparing, setComparing] = createSignal(false);
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [result, setResult] = createSignal<FolderDiffResult | null>(cachedResult);

  createEffect(() => {
    const projectFolder = getProjectFolder();
    if (!projectFolder) {
      return;
    }

    const nextCustomDefault = defaultCustomFolderFromRoot(projectFolder);
    const nextOldRetailDefault = defaultOldRetailFolderFromRoot(projectFolder);

    const currentCustom = customFolder();
    if (
      nextCustomDefault
      && (
        !currentCustom
        || normalizePath(currentCustom) === normalizePath(projectFolder)
      )
    ) {
      setCustomFolder(nextCustomDefault);
    }

    const currentOldRetail = oldRetailFolder();
    if (
      nextOldRetailDefault
      && (
        !currentOldRetail
        || normalizePath(currentOldRetail) === normalizePath(projectFolder)
      )
    ) {
      setOldRetailFolder(nextOldRetailDefault);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stateToSave: FileDiffsCachedState = {
      custom_folder: customFolder(),
      old_retail_folder: oldRetailFolder(),
      show_unchanged: showUnchanged(),
      last_notice: lastNotice(),
      result: result(),
    };

    window.sessionStorage.setItem(FILE_DIFFS_STATE_KEY, JSON.stringify(stateToSave));
  });

  const pickFolder = async (
    setter: (path: string) => void,
    defaultPath?: string,
  ) => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: defaultPath || undefined,
    });

    if (typeof selected === "string") {
      setter(selected);
      setResult(null);
      setLastNotice("");
    }
  };

  const runCompare = async () => {
    const resolvedNewRetailFolder = getDatFolder() || "";

    if (!customFolder() || !oldRetailFolder() || !resolvedNewRetailFolder) {
      await showMessage("Select Custom + Old Retail folders, then set the FFXI folder in the status bar.", {
        title: "Compare Blocked",
        kind: "warning",
      });
      return;
    }

    setComparing(true);
    try {
      const res = unwrap(await compareEntityNameFolders(
        customFolder(),
        oldRetailFolder(),
        resolvedNewRetailFolder,
      ));

      setResult(res);
      if (res.retail_changed_count === 0) {
        setLastNotice("No changed files found between old retail and new retail.");
      } else {
        setLastNotice(`Found ${res.retail_changed_count} changed file(s).`);
      }
    } catch (err) {
      await showMessage(`${err}`, { title: "Compare Error", kind: "error" });
    } finally {
      setComparing(false);
    }
  };

  const openInDiffTool = (customPath: string, newRetailPath: string, diffTool: "Entity" | "Item") => {
    const route = diffTool === "Item" ? "/item-diff" : "/entity-diff";
    navigate(`${route}?edited=${encodeURIComponent(customPath)}&newRetail=${encodeURIComponent(newRetailPath)}`);
  };

  return (
    <div class="w-full">
      <h1>File Diffs</h1>
      <hr />

      <div class="mt-3 flex flex-col gap-3">
        <div class="flex flex-row gap-2 items-center">
          <button class={compactButtonClass()} onclick={() => pickFolder(setCustomFolder, customFolder())}>
            Custom Folder
          </button>
          <span class="font-mono text-sm">{customFolder() || "Not selected"}</span>
        </div>

        <div class="flex flex-row gap-2 items-center">
          <button class={compactButtonClass()} onclick={() => pickFolder(setOldRetailFolder, oldRetailFolder())}>
            Old Retail Folder
          </button>
          <span class="font-mono text-sm">{oldRetailFolder() || "Not selected"}</span>
        </div>

        <div class="flex flex-row gap-2 items-center">
          <button class={compactButtonClass()} disabled={isComparing()} onclick={runCompare}>
            {isComparing() ? "Comparing..." : "Compare folders"}
          </button>
          <label class="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={showUnchanged()}
              onchange={(event) => setShowUnchanged(event.currentTarget.checked)}
            />
            Show unchanged DATs
          </label>
        </div>

        <Show when={lastNotice()}>
          <div class="text-sm italic text-slate-300">{lastNotice()}</div>
        </Show>

        <Show when={result()}>
          {(res) => (
            <>
              <div class="text-sm text-slate-300">
                Retail files scanned: {res().scanned_count} | Retail files changed: {res().retail_changed_count}
                {" "} | Retail files unchanged: {Math.max(0, res().scanned_count - res().retail_changed_count)}
                {" "} | Showing: {showUnchanged() ? res().all_files.length : res().changed_files.length}
              </div>

              <div class="max-h-[70vh] overflow-auto border border-slate-700 rounded-md">
                <table class="w-full">
                  <thead class="sticky top-0 z-10">
                    <tr>
                      <th>Relative Path</th>
                      <th>Name</th>
                      <th>Custom</th>
                      <th>Old Retail</th>
                      <th>New Retail</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={showUnchanged() ? res().all_files : res().changed_files}>
                      {(file) => (
                        <tr class="hover:bg-slate-700/40">
                          <td class="font-mono text-xs">{formatRelativePathForDisplay(file.relative_path)}</td>
                          <td>{file.zone_name ?? "Unknown"}</td>
                          <td>{file.custom_exists ? "Found" : "Missing"}</td>
                          <td>{file.old_retail_path ? "Found" : "Missing"}</td>
                          <td>{file.new_retail_path ? "Found" : "Missing"}</td>
                          <td>
                            <button
                              class={compactButtonClass()}
                              disabled={!file.custom_path || !file.new_retail_path}
                              onclick={() => {
                                if (!file.custom_path || !file.new_retail_path) {
                                  return;
                                }
                                openInDiffTool(file.custom_path, file.new_retail_path, file.diff_tool);
                              }}
                            >
                              {file.diff_tool === "Item" ? "Open in Item Diff" : "Open in Entity Diff"}
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

export default FileDiffsTool;
