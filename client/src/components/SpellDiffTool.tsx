import { open } from "@tauri-apps/plugin-dialog";
import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { SpellDiffRow, compareSpellFiles, saveSpellDiff } from "../custom_bindings";
import { showMessage } from "../dialogs";
import { useData } from "../store";
import { unwrap } from "../util";

function newFieldClass(changed: boolean) {
  return changed ? "bg-rose-950/35 text-rose-200" : "bg-emerald-950/35 text-emerald-200";
}

function splitPath(path: string): { dir: string; file: string } {
  const normalized = path.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) {
    return { dir: "", file: normalized };
  }

  return {
    dir: normalized.slice(0, idx),
    file: normalized.slice(idx + 1),
  };
}

function replaceExt(fileName: string, newExt: string): string {
  const idx = fileName.lastIndexOf(".");
  const base = idx > 0 ? fileName.slice(0, idx) : fileName;
  return `${base}${newExt}`;
}

function getRomRelativePath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  const romIndex = parts.findIndex((part) => /^rom\d*$/i.test(part));
  if (romIndex < 0) {
    return null;
  }

  const relative = parts.slice(romIndex).join("/");
  return relative || null;
}

function getOutputRoot(projectRoot: string | null): string | null {
  if (!projectRoot) {
    return null;
  }

  return projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
}

function buildAutoSavePaths(
  sourcePath: string,
  projectRoot: string | null,
): { yamlPath: string; datPath: string } | null {
  const outputRoot = getOutputRoot(projectRoot);
  if (!outputRoot) {
    return null;
  }

  const romRelativePath = getRomRelativePath(sourcePath);
  if (!romRelativePath) {
    return null;
  }

  const { dir: romDir, file } = splitPath(romRelativePath);
  const yamlFileName = replaceExt(file, ".yml");
  const datFileName = replaceExt(file, ".DAT");

  const yamlPath = romDir
    ? `${outputRoot}/Yaml/${romDir}/${yamlFileName}`
    : `${outputRoot}/Yaml/${yamlFileName}`;
  const datPath = romDir
    ? `${outputRoot}/${romDir}/${datFileName}`
    : `${outputRoot}/${datFileName}`;

  return { yamlPath, datPath };
}

function formatLevels(levels: Record<string, number> | null): string {
  if (!levels) {
    return "";
  }

  const entries = Object.entries(levels);
  if (entries.length === 0) {
    return "";
  }

  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([job, level]) => `${job}:${level}`).join(", ");
}

function parseLevels(text: string): Record<string, number> | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "-") {
    return {};
  }

  const parsed: Record<string, number> = {};
  const parts = trimmed.split(",");
  for (const part of parts) {
    const token = part.trim();
    if (!token) {
      continue;
    }

    const splitIdx = token.indexOf(":");
    if (splitIdx <= 0 || splitIdx >= token.length - 1) {
      return null;
    }

    const job = token.slice(0, splitIdx).trim();
    const levelText = token.slice(splitIdx + 1).trim();
    const level = Number(levelText);
    if (!job || !Number.isFinite(level) || level < 0 || !Number.isInteger(level)) {
      return null;
    }

    parsed[job.toUpperCase()] = level;
  }

  return parsed;
}

function pickerDefaultPath(currentPath: string, fallbackPath: string) {
  if (!currentPath) {
    return fallbackPath;
  }

  const { dir } = splitPath(currentPath);
  return dir || fallbackPath;
}

function rowMatchesFilter(row: SpellDiffRow, filterText: string) {
  const name = row.new_name ?? row.old_name ?? "";
  const levels = formatLevels(row.new_level_required ?? row.old_level_required ?? null);

  const haystack = [
    name,
    row.new_index ?? row.old_index,
    row.new_mp_cost ?? row.old_mp_cost,
    row.new_cast_time ?? row.old_cast_time,
    row.new_recast_time ?? row.old_recast_time,
    levels,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => `${value}`.toLowerCase())
    .join(" ");

  return haystack.includes(filterText);
}

function buildRowIndexById(rows: SpellDiffRow[]) {
  const indexById = new Map<number, number>();
  rows.forEach((row, index) => {
    indexById.set(row.row, index);
  });
  return indexById;
}

const compactButtonBaseClass = "my-0 px-1.5 py-0.5 text-xs font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
const compactButtonActiveClass = "bg-green-800 border-green-500 text-slate-100";

const SPELL_RELATIVE_PATH = "ROM/118/114.DAT";
const SPELL_EDITOR_STATE_KEY = "xi_tinkerer_spell_editor_state_v1";

const SPELL_EDITOR_COLUMN_COUNT = 6;
const VIRTUAL_ROW_HEIGHT_PX = 34;
const VIRTUAL_OVERSCAN_ROWS = 16;

interface SpellEditorCachedState {
  spell_path: string;
  rows?: SpellDiffRow[];
  table_filter: string;
  last_notice: string;
  last_saved_yaml_path: string;
  last_saved_dat_path: string;
}

function compactButtonClass(active = false) {
  return `${compactButtonBaseClass} ${active ? compactButtonActiveClass : compactButtonIdleClass}`;
}

function spellPathFromProjectRoot(projectRoot: string | null): string | null {
  if (!projectRoot) {
    return null;
  }

  const normalizedRoot = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return `${normalizedRoot}/${SPELL_RELATIVE_PATH}`;
}

function loadCachedState(): SpellEditorCachedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(SPELL_EDITOR_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as SpellEditorCachedState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function SpellDiffTool() {
  const {
    folders: { getDatFolder, getProjectFolder },
  } = useData();
  const [searchParams] = useSearchParams();
  const cachedState = loadCachedState();

  const [spellPath, setSpellPath] = createSignal(cachedState?.spell_path ?? "");
  const [rows, setRows] = createStore<SpellDiffRow[]>(cachedState?.rows ?? []);
  const [rowIndexById, setRowIndexById] = createSignal<Map<number, number>>(buildRowIndexById(cachedState?.rows ?? []));
  const [tableFilter, setTableFilter] = createSignal(cachedState?.table_filter ?? "");
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [lastSavedYamlPath, setLastSavedYamlPath] = createSignal(cachedState?.last_saved_yaml_path ?? "");
  const [lastSavedDatPath, setLastSavedDatPath] = createSignal(cachedState?.last_saved_dat_path ?? "");

  const [isLoading, setLoading] = createSignal(false);
  const [isSaving, setSaving] = createSignal(false);
  const [prefillApplied, setPrefillApplied] = createSignal(false);
  const [rowsVersion, setRowsVersion] = createSignal(0);

  const [scrollTop, setScrollTop] = createSignal(0);
  const [tableViewportHeight, setTableViewportHeight] = createSignal(480);

  const [levelDrafts, setLevelDrafts] = createStore<Record<number, string>>({});

  let tableContainerRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let persistStateTimer: number | undefined;

  const displayedRows = createMemo(() => {
    const filterText = tableFilter().trim().toLowerCase();
    if (!filterText) {
      return rows;
    }
    return rows.filter((row) => rowMatchesFilter(row, filterText));
  });

  const virtualWindow = createMemo(() => {
    const totalRows = displayedRows().length;
    const rowHeight = VIRTUAL_ROW_HEIGHT_PX;
    const viewportHeight = tableViewportHeight();
    const top = scrollTop();

    const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const start = Math.max(0, Math.floor(top / rowHeight) - VIRTUAL_OVERSCAN_ROWS);
    const end = Math.min(totalRows, start + visibleRowCount + VIRTUAL_OVERSCAN_ROWS * 2);
    const topPadding = start * rowHeight;
    const bottomPadding = Math.max(0, (totalRows - end) * rowHeight);

    return { start, end, topPadding, bottomPadding };
  });

  const visibleRows = createMemo(() => {
    const { start, end } = virtualWindow();
    return displayedRows().slice(start, end);
  });

  const resetLoadedRows = () => {
    setRows([]);
    setRowIndexById(new Map());
    for (const key of Object.keys(levelDrafts)) {
      delete levelDrafts[Number(key)];
    }
    setRowsVersion((version) => version + 1);
  };

  const preferredSpellPath = createMemo(() => {
    const spellPathFromProject = spellPathFromProjectRoot(getProjectFolder());
    if (spellPathFromProject) {
      return spellPathFromProject;
    }

    const ffxiRoot = getDatFolder();
    if (ffxiRoot) {
      return `${ffxiRoot.replaceAll("\\", "/").replace(/\/+$/, "")}/${SPELL_RELATIVE_PATH}`;
    }

    return "";
  });

  const setSpellFile = (path: string) => {
    setSpellPath(path);
    resetLoadedRows();
    setLastNotice("");
  };

  const syncTableViewport = () => {
    if (!tableContainerRef) {
      return;
    }
    setTableViewportHeight(tableContainerRef.clientHeight || 480);
    setScrollTop(tableContainerRef.scrollTop || 0);
  };

  const onTableScroll = () => {
    if (scrollFrame !== 0) {
      return;
    }

    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      syncTableViewport();
    });
  };

  const loadSpellData = async () => {
    if (!spellPath()) {
      await showMessage("Select the spell DAT/YAML file first.", { title: "Load Blocked", kind: "warning" });
      return;
    }

    setLoading(true);
    try {
      const result = unwrap(await compareSpellFiles(spellPath(), spellPath()));
      batch(() => {
        const preparedRows = result.rows.map((row) => ({
          ...row,
          choice: "New",
          new_name: row.new_name ?? row.old_name,
          new_index: row.new_index ?? row.old_index,
          new_mp_cost: row.new_mp_cost ?? row.old_mp_cost,
          new_cast_time: row.new_cast_time ?? row.old_cast_time,
          new_recast_time: row.new_recast_time ?? row.old_recast_time,
          new_level_required: row.new_level_required ?? row.old_level_required ?? {},
        }));
        setRows(() => preparedRows);
        setRowIndexById(buildRowIndexById(preparedRows));
        setLastNotice(`Loaded ${result.rows.length} spell rows.`);
        setRowsVersion((version) => version + 1);
      });
      for (const key of Object.keys(levelDrafts)) {
        delete levelDrafts[Number(key)];
      }
    } catch (err) {
      await showMessage(`${err}`, { title: "Load Error", kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (prefillApplied()) {
      return;
    }

    const fromQuery = searchParams.edited || searchParams.path;
    batch(() => {
      if (fromQuery) {
        setSpellFile(fromQuery);
      }
      setPrefillApplied(true);
    });
  });

  createEffect(() => {
    if (spellPath()) {
      return;
    }

    setSpellPath(preferredSpellPath());
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    spellPath();
    rowsVersion();
    tableFilter();
    lastNotice();
    lastSavedYamlPath();
    lastSavedDatPath();

    if (persistStateTimer !== undefined) {
      window.clearTimeout(persistStateTimer);
    }

    persistStateTimer = window.setTimeout(() => {
      const stateToSave: SpellEditorCachedState = {
        spell_path: spellPath(),
        table_filter: tableFilter(),
        last_notice: lastNotice(),
        last_saved_yaml_path: lastSavedYamlPath(),
        last_saved_dat_path: lastSavedDatPath(),
      };

      try {
        window.sessionStorage.setItem(SPELL_EDITOR_STATE_KEY, JSON.stringify(stateToSave));
      } catch (error) {
        console.warn("Failed to persist spell editor UI state.", error);
      }
      persistStateTimer = undefined;
    }, 250);
  });

  onCleanup(() => {
    if (persistStateTimer !== undefined) {
      window.clearTimeout(persistStateTimer);
    }
  });

  onMount(() => {
    syncTableViewport();

    const handleResize = () => syncTableViewport();
    window.addEventListener("resize", handleResize);

    if (rows.length === 0 && spellPath()) {
      void loadSpellData();
    }

    return () => {
      if (scrollFrame !== 0) {
        window.cancelAnimationFrame(scrollFrame);
      }
      window.removeEventListener("resize", handleResize);
    };
  });

  const pickFile = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: pickerDefaultPath(spellPath(), preferredSpellPath()),
      filters: [{ name: "DAT or YAML", extensions: ["dat", "yml", "yaml"] }],
    });

    if (typeof selected === "string") {
      setSpellFile(selected);
    }
  };

  const setRowNewU32 = (rowId: number, key: "new_mp_cost" | "new_cast_time" | "new_recast_time", value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    const rowIndex = rowIndexById().get(rowId);
    if (rowIndex === undefined) {
      return;
    }

    setRows(rowIndex, key, Math.trunc(parsed));
    setRowsVersion((version) => version + 1);
  };

  const levelInputValue = (row: SpellDiffRow) => {
    const draft = levelDrafts[row.row];
    if (typeof draft === "string") {
      return draft;
    }

    return formatLevels(row.new_level_required ?? row.old_level_required ?? null);
  };

  const setLevelDraft = (rowId: number, value: string) => {
    setLevelDrafts(rowId, value);
  };

  const applyLevelDraft = async (rowId: number) => {
    const draft = levelDrafts[rowId];
    if (draft === undefined) {
      return;
    }

    const parsed = parseLevels(draft);
    if (!parsed) {
      await showMessage(`Invalid level format for row ${rowId}. Use format like WHM:1, RDM:3`, {
        title: "Invalid Level Format",
        kind: "warning",
      });
      return;
    }

    const rowIndex = rowIndexById().get(rowId);
    if (rowIndex === undefined) {
      return;
    }

    setRows(rowIndex, "new_level_required", parsed);
    setLevelDrafts(rowId, formatLevels(parsed));
    setRowsVersion((version) => version + 1);
  };

  const saveEdited = async () => {
    if (rows.length === 0) {
      await showMessage("Load the spell file first.", { title: "Save Blocked", kind: "warning" });
      return;
    }

    const autoPaths = buildAutoSavePaths(spellPath(), getProjectFolder());
    if (!autoPaths) {
      await showMessage(
        "Set Project Folder and use files under a ROM path (for example ROM/118/114.DAT) so save can be auto-routed.",
        { title: "Project Folder Required", kind: "warning" },
      );
      return;
    }

    const outYamlPath = autoPaths.yamlPath;
    const outDatPath: string | null = autoPaths.datPath;

    const payloadRows = rows.map((row) => ({ ...row, choice: "New" as const }));

    setSaving(true);
    try {
      const result = unwrap(await saveSpellDiff(spellPath(), spellPath(), payloadRows, outYamlPath, outDatPath));
      setLastSavedYamlPath(result.out_yaml_path);
      setLastSavedDatPath(result.out_dat_path ?? "");
      setLastNotice(`Saved ${result.written_count} spell entries.`);
      await showMessage(
        `Saved ${result.written_count} spell entries.\nYAML: ${result.out_yaml_path}${result.out_dat_path ? `\nDAT: ${result.out_dat_path}` : ""}`,
        { title: "Saved", kind: "info" },
      );
    } catch (err) {
      await showMessage(`${err}`, { title: "Save Error", kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="w-full">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <h1 class="m-0">Spell Editor</h1>
        <div class="flex flex-col items-end gap-0.5 text-xs">
          <Show when={lastSavedYamlPath()}>
            <div class="max-w-[62vw] text-right truncate">
              Last saved YAML: <span class="font-mono text-green-200">{lastSavedYamlPath()}</span>
            </div>
          </Show>
          <Show when={lastSavedDatPath()}>
            <div class="max-w-[62vw] text-right truncate">
              Last saved DAT: <span class="font-mono text-green-200">{lastSavedDatPath()}</span>
            </div>
          </Show>
        </div>
      </div>
      <hr />

      <div class="mt-3 flex flex-col gap-2">
        <div class="rounded-md border border-slate-700/70 bg-slate-900/20 p-2 flex flex-col gap-2">
          <div class="min-w-0 flex items-center gap-2">
            <button class={compactButtonClass()} onclick={pickFile}>Spell DAT/YAML</button>
            <span class="font-mono text-xs truncate" title={spellPath() || "Not selected"}>
              {spellPath() || "Not selected"}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class={compactButtonClass()} disabled={isLoading()} onclick={loadSpellData}>
              {isLoading() ? "Loading..." : "Load"}
            </button>

            <button class={compactButtonClass()} disabled={isSaving() || rows.length === 0} onclick={saveEdited}>
              {isSaving() ? "Saving..." : "Save"}
            </button>

            <Show when={rows.length > 0}>
              <input
                class="m-0 min-w-[12rem] flex-1 md:flex-none md:w-64 py-0.5 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                placeholder="Search rows..."
                value={tableFilter()}
                onInput={(e) => setTableFilter(e.currentTarget.value)}
              />
            </Show>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
            <Show when={lastNotice()}>
              <div class="italic text-slate-300">{lastNotice()}</div>
            </Show>
            <Show when={rows.length > 0}>
              <div class="text-slate-300">Loaded spell entries: {rows.length}</div>
            </Show>
          </div>
        </div>

        <Show when={rows.length > 0}>
          <div
            class="max-h-[70vh] overflow-auto border border-slate-700 rounded-md"
            ref={(el) => {
              tableContainerRef = el;
            }}
            onScroll={onTableScroll}
          >
            <table class="w-full">
              <thead class="sticky top-0 z-10">
                <tr>
                  <th>Name</th>
                  <th>Index</th>
                  <th>MP Cost</th>
                  <th>Cast Time</th>
                  <th>Recast Time</th>
                  <th>Level Required</th>
                </tr>
              </thead>
              <tbody>
                <Show when={virtualWindow().topPadding > 0}>
                  <tr>
                    <td colSpan={SPELL_EDITOR_COLUMN_COUNT} style={{ height: `${virtualWindow().topPadding}px`, padding: "0", border: "0" }}></td>
                  </tr>
                </Show>

                <For each={visibleRows()}>
                  {(row) => (
                    <tr>
                      <td class="max-w-[18rem] truncate" title={row.new_name ?? row.old_name ?? "-"}>
                        {row.new_name ?? row.old_name ?? "-"}
                      </td>
                      <td class="font-mono">{row.new_index ?? row.old_index ?? "-"}</td>
                      <td class={newFieldClass((row.old_mp_cost ?? null) !== (row.new_mp_cost ?? null))}>
                        <input
                          class={`hide-spin-buttons m-0 !w-[10ch] min-w-[10ch] max-w-[10ch] py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_mp_cost ?? null) !== (row.new_mp_cost ?? null))}`}
                          type="number"
                          min={0}
                          step={1}
                          value={row.new_mp_cost ?? ""}
                          onInput={(e) => setRowNewU32(row.row, "new_mp_cost", e.currentTarget.value)}
                        />
                      </td>
                      <td class={newFieldClass((row.old_cast_time ?? null) !== (row.new_cast_time ?? null))}>
                        <input
                          class={`hide-spin-buttons m-0 !w-[10ch] min-w-[10ch] max-w-[10ch] py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_cast_time ?? null) !== (row.new_cast_time ?? null))}`}
                          type="number"
                          min={0}
                          step={1}
                          value={row.new_cast_time ?? ""}
                          onInput={(e) => setRowNewU32(row.row, "new_cast_time", e.currentTarget.value)}
                        />
                      </td>
                      <td class={newFieldClass((row.old_recast_time ?? null) !== (row.new_recast_time ?? null))}>
                        <input
                          class={`hide-spin-buttons m-0 !w-[10ch] min-w-[10ch] max-w-[10ch] py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_recast_time ?? null) !== (row.new_recast_time ?? null))}`}
                          type="number"
                          min={0}
                          step={1}
                          value={row.new_recast_time ?? ""}
                          onInput={(e) => setRowNewU32(row.row, "new_recast_time", e.currentTarget.value)}
                        />
                      </td>
                      <td class={newFieldClass(formatLevels(row.old_level_required ?? null) !== formatLevels(row.new_level_required ?? null))}>
                        <input
                          class={`m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(formatLevels(row.old_level_required ?? null) !== formatLevels(row.new_level_required ?? null))}`}
                          type="text"
                          value={levelInputValue(row)}
                          onInput={(e) => setLevelDraft(row.row, e.currentTarget.value)}
                          onBlur={() => {
                            void applyLevelDraft(row.row);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </For>

                <Show when={virtualWindow().bottomPadding > 0}>
                  <tr>
                    <td colSpan={SPELL_EDITOR_COLUMN_COUNT} style={{ height: `${virtualWindow().bottomPadding}px`, padding: "0", border: "0" }}></td>
                  </tr>
                </Show>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default SpellDiffTool;
