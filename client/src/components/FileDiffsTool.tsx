import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "@solidjs/router";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { FolderDiffEntry, FolderDiffResult, compareEntityNameFolders } from "../custom_bindings";
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
  return `${normalizePath(root)}/Custom`;
}

function defaultRetailBaseFolderFromRoot(root: string | null): string | null {
  if (!root) {
    return null;
  }
  return `${normalizePath(root)}/Retail Base`;
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

const FILE_DIFFS_STATE_KEY = "xi_tinkerer_file_diffs_state_v2";

type FileDiffSortColumn =
  | "relative_path"
  | "zone_name"
  | "custom_exists"
  | "old_retail_path"
  | "new_retail_path"
  | "diff_tool";

interface FileDiffsCachedState {
  custom_folder: string;
  retail_base_folder: string;
  old_retail_folder?: string;
  show_unchanged: boolean;
  sort_column?: FileDiffSortColumn;
  sort_ascending?: boolean;
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

function isFileDiffSortColumn(value: unknown): value is FileDiffSortColumn {
  return (
    value === "relative_path"
    || value === "zone_name"
    || value === "custom_exists"
    || value === "old_retail_path"
    || value === "new_retail_path"
    || value === "diff_tool"
  );
}

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function sortValueForFile(file: FolderDiffEntry, column: FileDiffSortColumn): string {
  switch (column) {
    case "relative_path":
      return formatRelativePathForDisplay(file.relative_path);
    case "zone_name":
      return file.zone_name ?? "Unknown";
    case "custom_exists":
      return file.custom_exists ? "Found" : "Missing";
    case "old_retail_path":
      return file.old_retail_path ? "Found" : "Missing";
    case "new_retail_path":
      return file.new_retail_path ? "Found" : "Missing";
    case "diff_tool":
      return file.diff_tool;
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
  const initialRetailBaseDefault = defaultRetailBaseFolderFromRoot(projectRoot);

  const [customFolder, setCustomFolder] = createSignal(
    cachedState?.custom_folder ?? initialCustomDefault ?? "",
  );
  const [retailBaseFolder, setRetailBaseFolder] = createSignal(
    cachedState?.retail_base_folder ?? cachedState?.old_retail_folder ?? initialRetailBaseDefault ?? "",
  );
  const [showUnchanged, setShowUnchanged] = createSignal(cachedState?.show_unchanged ?? false);
  const [sortColumn, setSortColumn] = createSignal<FileDiffSortColumn>(
    isFileDiffSortColumn(cachedState?.sort_column) ? cachedState.sort_column : "relative_path",
  );
  const [sortAscending, setSortAscending] = createSignal(cachedState?.sort_ascending ?? true);

  const [isComparing, setComparing] = createSignal(false);
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [result, setResult] = createSignal<FolderDiffResult | null>(cachedResult);

  const visibleFiles = createMemo(() => {
    const res = result();
    if (!res) {
      return [];
    }

    const column = sortColumn();
    const direction = sortAscending() ? 1 : -1;
    const source = showUnchanged() ? res.all_files : res.changed_files;
    return [...source].sort((left, right) => {
      const primary = compareStrings(sortValueForFile(left, column), sortValueForFile(right, column));
      if (primary !== 0) {
        return primary * direction;
      }

      return compareStrings(left.relative_path, right.relative_path);
    });
  });

  createEffect(() => {
    const projectFolder = getProjectFolder();
    if (!projectFolder) {
      return;
    }

    const nextCustomDefault = defaultCustomFolderFromRoot(projectFolder);
    const nextRetailBaseDefault = defaultRetailBaseFolderFromRoot(projectFolder);
    const previousOldRetailDefault = defaultOldRetailFolderFromRoot(projectFolder);

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

    const currentRetailBase = retailBaseFolder();
    if (
      nextRetailBaseDefault
      && (
        !currentRetailBase
        || normalizePath(currentRetailBase) === normalizePath(projectFolder)
        || (
          previousOldRetailDefault
          && normalizePath(currentRetailBase) === normalizePath(previousOldRetailDefault)
        )
      )
    ) {
      setRetailBaseFolder(nextRetailBaseDefault);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stateToSave: FileDiffsCachedState = {
      custom_folder: customFolder(),
      retail_base_folder: retailBaseFolder(),
      show_unchanged: showUnchanged(),
      sort_column: sortColumn(),
      sort_ascending: sortAscending(),
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

    if (!customFolder() || !retailBaseFolder() || !resolvedNewRetailFolder) {
      await showMessage("Select Custom + Retail Base folders, then set the FFXI folder in the status bar.", {
        title: "Compare Blocked",
        kind: "warning",
      });
      return;
    }

    setComparing(true);
    try {
      const res = unwrap(await compareEntityNameFolders(
        customFolder(),
        retailBaseFolder(),
        resolvedNewRetailFolder,
      ));

      setResult(res);
      if (res.retail_changed_count === 0) {
        setLastNotice("No changed files found between Retail Base and new retail.");
      } else {
        setLastNotice(`Found ${res.retail_changed_count} changed file(s).`);
      }
    } catch (err) {
      await showMessage(`${err}`, { title: "Compare Error", kind: "error" });
    } finally {
      setComparing(false);
    }
  };

  const updateSort = (column: FileDiffSortColumn) => {
    if (column === sortColumn()) {
      setSortAscending((ascending) => !ascending);
      return;
    }

    setSortColumn(column);
    setSortAscending(true);
  };

  const sortMarker = (column: FileDiffSortColumn) => {
    if (column !== sortColumn()) {
      return "";
    }

    return sortAscending() ? " ^" : " v";
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
          <button class={compactButtonClass()} onclick={() => pickFolder(setRetailBaseFolder, retailBaseFolder())}>
            Retail Base Folder
          </button>
          <span class="font-mono text-sm">{retailBaseFolder() || "Not selected"}</span>
        </div>

        <div class="flex flex-row gap-2 items-center">
          <button class={compactButtonClass()} disabled={isComparing()} onclick={runCompare}>
            {isComparing() ? "Comparing..." : "Compare folders"}
          </button>
          <label class="flex items-center gap-3 text-sm whitespace-nowrap">
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
                {" "} | Showing: {visibleFiles().length}
              </div>

              <div class="max-h-[70vh] overflow-auto border border-slate-700 rounded-md">
                <table class="w-full">
                  <thead class="sticky top-0 z-10">
                    <tr>
                      <th class="table-sortable whitespace-nowrap" onclick={() => updateSort("relative_path")}>
                        Relative Path{sortMarker("relative_path")}
                      </th>
                      <th class="table-sortable whitespace-nowrap" onclick={() => updateSort("zone_name")}>
                        Name{sortMarker("zone_name")}
                      </th>
                      <th class="table-sortable whitespace-nowrap" onclick={() => updateSort("custom_exists")}>
                        Custom{sortMarker("custom_exists")}
                      </th>
                      <th class="table-sortable whitespace-nowrap" onclick={() => updateSort("old_retail_path")}>
                        Retail Base{sortMarker("old_retail_path")}
                      </th>
                      <th class="table-sortable whitespace-nowrap" onclick={() => updateSort("new_retail_path")}>
                        New Retail{sortMarker("new_retail_path")}
                      </th>
                      <th class="table-sortable whitespace-nowrap" onclick={() => updateSort("diff_tool")}>
                        Action{sortMarker("diff_tool")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={visibleFiles()}>
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
