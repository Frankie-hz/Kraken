import { open } from "@tauri-apps/plugin-dialog";
import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  EntityDiffChoice,
  EntityDiffRow,
  compareEntityNameFiles,
  saveEntityNameDiff,
} from "../custom_bindings";
import { showMessage } from "../dialogs";
import { useData } from "../store";
import { unwrap } from "../util";

function isChangedRow(row: EntityDiffRow) {
  return (
    row.old_id !== row.new_id ||
    row.old_name !== row.new_name ||
    row.old_id === null ||
    row.new_id === null
  );
}

function newFieldClass(changed: boolean) {
  return changed ? "bg-rose-950/35 text-rose-200" : "bg-emerald-950/35 text-emerald-200";
}

function defaultChoiceForRow(row: EntityDiffRow): EntityDiffChoice {
  if (row.new_id !== null && row.new_name !== null) {
    return "New";
  }
  return "Old";
}

function defaultTargetForRow(row: EntityDiffRow): number | null {
  return row.new_id ?? row.old_id ?? null;
}

function targetOptionsForRow(row: EntityDiffRow): number[] {
  const ids = [row.new_id, row.old_id].filter((id): id is number => id !== null);
  const deduped = Array.from(new Set(ids));
  return deduped;
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

function normalizePathForCompare(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
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

  return `${projectRoot.replaceAll("\\", "/").replace(/\/+$/, "")}/Custom`;
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

const compactButtonBaseClass = "my-0 px-1.5 py-0.5 text-xs font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
const compactButtonActiveClass = "bg-green-800 border-green-500 text-slate-100";
const ENTITY_DIFF_STATE_KEY = "xi_tinkerer_entity_diff_state_v1";
const ENTITY_DIFF_COLUMN_COUNT = 7;
const VIRTUAL_ROW_HEIGHT_PX = 34;
const VIRTUAL_OVERSCAN_ROWS = 16;

interface EntityDiffCachedState {
  edited_path: string;
  new_retail_path: string;
  rows?: EntityDiffRow[];
  old_count: number;
  new_count: number;
  changed_count: number;
  show_changed_only: boolean;
  table_filter: string;
  manual_edit: boolean;
  last_notice: string;
  last_saved_yaml_path: string;
  last_saved_dat_path: string;
}

function compactButtonClass(active = false) {
  return `${compactButtonBaseClass} ${active ? compactButtonActiveClass : compactButtonIdleClass}`;
}

function inferRetailPathFromEdited(editedPath: string, ffxiRoot: string | null): string | null {
  if (!ffxiRoot) {
    return null;
  }

  const normalized = editedPath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  const romIndex = parts.findIndex((part) => /^rom\d*$/i.test(part));
  if (romIndex < 0) {
    return null;
  }

  const romRelativePath = parts.slice(romIndex).join("/");
  if (!romRelativePath) {
    return null;
  }

  const normalizedRoot = ffxiRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return `${normalizedRoot}/${romRelativePath}`;
}

function pickerDefaultPath(currentPath: string, fallbackDir: string | null) {
  if (!currentPath) {
    return fallbackDir ?? undefined;
  }

  const { dir } = splitPath(currentPath);
  return dir || fallbackDir || undefined;
}

function loadCachedState(): EntityDiffCachedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(ENTITY_DIFF_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as EntityDiffCachedState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function rowMatchesFilter(row: EntityDiffRow, filterText: string) {
  const haystack = [
    row.row,
    row.old_id,
    row.old_name,
    row.old_stack_size,
    row.new_id,
    row.new_name,
    row.new_stack_size,
    row.target_id,
    row.choice,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => `${value}`.toLowerCase())
    .join(" ");

  return haystack.includes(filterText);
}

function buildRowIndexById(rows: EntityDiffRow[]) {
  const indexById = new Map<number, number>();
  rows.forEach((row, index) => {
    indexById.set(row.row, index);
  });
  return indexById;
}

function buildChangedRowIdSet(rows: EntityDiffRow[]) {
  return new Set(rows.filter((row) => isChangedRow(row)).map((row) => row.row));
}

function EntityDiffTool() {
  const {
    folders: { getDatFolder, getProjectFolder },
  } = useData();
  const [searchParams] = useSearchParams();
  const cachedState = loadCachedState();

  const [editedPath, setEditedPath] = createSignal(cachedState?.edited_path ?? "");
  const [newRetailPath, setNewRetailPath] = createSignal(cachedState?.new_retail_path ?? "");

  const [rows, setRows] = createStore<EntityDiffRow[]>(cachedState?.rows ?? []);
  const [rowIndexById, setRowIndexById] = createSignal<Map<number, number>>(buildRowIndexById(cachedState?.rows ?? []));
  const [changedRowIds, setChangedRowIds] = createSignal<Set<number>>(buildChangedRowIdSet(cachedState?.rows ?? []));
  const [oldCount, setOldCount] = createSignal(cachedState?.old_count ?? 0);
  const [newCount, setNewCount] = createSignal(cachedState?.new_count ?? 0);
  const [changedCount, setChangedCount] = createSignal(cachedState?.changed_count ?? 0);

  const [isComparing, setComparing] = createSignal(false);
  const [isSaving, setSaving] = createSignal(false);
  const [showChangedOnly, setShowChangedOnly] = createSignal(cachedState?.show_changed_only ?? true);
  const [tableFilter, setTableFilter] = createSignal(cachedState?.table_filter ?? "");
  const [manualEdit, setManualEdit] = createSignal(cachedState?.manual_edit ?? false);
  const [prefillApplied, setPrefillApplied] = createSignal(false);
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [lastSavedYamlPath, setLastSavedYamlPath] = createSignal(cachedState?.last_saved_yaml_path ?? "");
  const [lastSavedDatPath, setLastSavedDatPath] = createSignal(cachedState?.last_saved_dat_path ?? "");
  const [rowsVersion, setRowsVersion] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [tableViewportHeight, setTableViewportHeight] = createSignal(480);

  let tableContainerRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let persistStateTimer: number | undefined;

  const changedRowsSelectedOld = createMemo(() => {
    const changed = changedRowIds();
    const indexById = rowIndexById();
    let count = 0;
    for (const rowId of changed) {
      const index = indexById.get(rowId);
      if (index !== undefined && rows[index]?.choice === "Old") {
        count += 1;
      }
    }
    return count;
  });

  const displayedRows = createMemo(() => {
    const filterText = tableFilter().trim().toLowerCase();
    const changed = changedRowIds();
    const baseRows = showChangedOnly() ? rows.filter((row) => changed.has(row.row)) : rows;
    if (!filterText) {
      return baseRows;
    }

    return baseRows.filter((row) => rowMatchesFilter(row, filterText));
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
    setChangedRowIds(new Set());
    setOldCount(0);
    setNewCount(0);
    setChangedCount(0);
    setRowsVersion((version) => version + 1);
  };

  const setEditedFile = (path: string) => {
    setEditedPath(path);

    const inferredRetailPath = inferRetailPathFromEdited(path, getDatFolder());
    if (inferredRetailPath) {
      setNewRetailPath(inferredRetailPath);
    }

    resetLoadedRows();
    setLastNotice("");
  };

  const setNewRetailFile = (path: string) => {
    setNewRetailPath(path);
    resetLoadedRows();
    setLastNotice("");
  };

  createEffect(() => {
    if (prefillApplied()) {
      return;
    }

    const fromListEdited = searchParams.edited;
    const fromListNewRetail = searchParams.newRetail;

    batch(() => {
      if (fromListEdited) {
        setEditedFile(fromListEdited);
      }
      if (fromListNewRetail) {
        setNewRetailFile(fromListNewRetail);
      }
      setPrefillApplied(true);
    });
  });

  createEffect(() => {
    if (!editedPath() || newRetailPath()) {
      return;
    }

    const inferredRetailPath = inferRetailPathFromEdited(editedPath(), getDatFolder());
    if (inferredRetailPath) {
      setNewRetailPath(inferredRetailPath);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    editedPath();
    newRetailPath();
    rowsVersion();
    oldCount();
    newCount();
    changedCount();
    showChangedOnly();
    tableFilter();
    manualEdit();
    lastNotice();
    lastSavedYamlPath();
    lastSavedDatPath();

    if (persistStateTimer !== undefined) {
      window.clearTimeout(persistStateTimer);
    }

    persistStateTimer = window.setTimeout(() => {
      const stateToSave: EntityDiffCachedState = {
        edited_path: editedPath(),
        new_retail_path: newRetailPath(),
        old_count: oldCount(),
        new_count: newCount(),
        changed_count: changedCount(),
        show_changed_only: showChangedOnly(),
        table_filter: tableFilter(),
        manual_edit: manualEdit(),
        last_notice: lastNotice(),
        last_saved_yaml_path: lastSavedYamlPath(),
        last_saved_dat_path: lastSavedDatPath(),
      };

      try {
        window.sessionStorage.setItem(ENTITY_DIFF_STATE_KEY, JSON.stringify(stateToSave));
      } catch (error) {
        console.warn("Failed to persist entity diff UI state.", error);
      }
      persistStateTimer = undefined;
    }, 250);
  });

  onCleanup(() => {
    if (persistStateTimer !== undefined) {
      window.clearTimeout(persistStateTimer);
    }
  });

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

  onMount(() => {
    syncTableViewport();

    const handleResize = () => syncTableViewport();
    window.addEventListener("resize", handleResize);

    if (rows.length === 0 && editedPath() && newRetailPath()) {
      void runCompare();
    }

    return () => {
      if (scrollFrame !== 0) {
        window.cancelAnimationFrame(scrollFrame);
      }
      window.removeEventListener("resize", handleResize);
    };
  });

  const pickFile = async (
    pathSetter: (path: string) => void,
    defaultPath?: string,
  ) => {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: defaultPath || undefined,
      filters: [
        { name: "DAT or YAML", extensions: ["dat", "yml", "yaml"] },
      ],
    });

    if (typeof selected === "string") {
      pathSetter(selected);
    }
  };

  const runCompare = async () => {
    if (!editedPath() || !newRetailPath()) {
      await showMessage("Select edited and new retail files first.", { title: "Compare Required", kind: "warning" });
      return;
    }

    setComparing(true);
    try {
      const result = unwrap(await compareEntityNameFiles(editedPath(), newRetailPath()));
      batch(() => {
        const preparedRows = result.rows.map((row) => ({
          ...row,
          choice: defaultChoiceForRow(row),
          target_id: row.target_id ?? defaultTargetForRow(row),
        }));
        setRows(() => preparedRows);
        setRowIndexById(buildRowIndexById(preparedRows));
        setChangedRowIds(buildChangedRowIdSet(preparedRows));
        setOldCount(result.old_count);
        setNewCount(result.new_count);
        setChangedCount(result.changed_count);
        setLastNotice(`Loaded ${result.changed_count} changed row(s).`);
        setRowsVersion((version) => version + 1);
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Compare Error", kind: "error" });
    } finally {
      setComparing(false);
    }
  };

  const updateRowById = (rowId: number, updater: (row: EntityDiffRow) => void) => {
    const index = rowIndexById().get(rowId);
    if (index === undefined) {
      return;
    }

    const currentRow = rows[index];
    if (!currentRow) {
      return;
    }

    const nextRow = { ...currentRow };
    updater(nextRow);

    const wasChanged = isChangedRow(currentRow);
    const isNowChanged = isChangedRow(nextRow);

    setRows(index, nextRow);
    if (wasChanged !== isNowChanged) {
      setChangedRowIds((current) => {
        const next = new Set(current);
        if (isNowChanged) {
          next.add(rowId);
        } else {
          next.delete(rowId);
        }
        return next;
      });
    }
    setRowsVersion((version) => version + 1);
  };

  const setRowChoice = (rowId: number, choice: EntityDiffChoice) => {
    updateRowById(rowId, (row) => {
      row.choice = choice;
    });
  };

  const setRowTargetId = (rowId: number, targetId: number | null) => {
    updateRowById(rowId, (row) => {
      row.target_id = targetId;
    });
  };

  const setRowNewId = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const newId = Math.trunc(parsed);
    if (newId < 0) {
      return;
    }

    updateRowById(rowId, (row) => {
      const previousNewId = row.new_id ?? null;
      const previousTargetId = row.target_id ?? null;

      row.new_id = newId;
      if (previousTargetId === null || previousTargetId === previousNewId) {
        row.target_id = newId;
      }
    });
  };

  const setRowNewName = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_name = value;
    });
  };

  const applyBulkChoice = (choice: EntityDiffChoice, onlyChanged: boolean) => {
    setRows(produce((draft) => {
      for (const row of draft) {
        if (onlyChanged && !isChangedRow(row)) {
          continue;
        }

        if (choice === "Old" && row.old_id !== null && row.old_name !== null) {
          row.choice = "Old";
        } else if (choice === "New" && row.new_id !== null && row.new_name !== null) {
          row.choice = "New";
        }

        if (row.target_id === null) {
          row.target_id = defaultTargetForRow(row);
        }
      }
    }));
    setRowsVersion((version) => version + 1);
  };

  const keepAllNewIds = () => {
    setRows(produce((draft) => {
      for (const row of draft) {
        if (row.new_id !== null) {
          row.target_id = row.new_id;
        }
      }
    }));
    setRowsVersion((version) => version + 1);
  };

  const saveMerged = async () => {
    if (rows.length === 0) {
      await showMessage("Compare files first so there is something to save.", { title: "Nothing To Save", kind: "warning" });
      return;
    }

    if (!editedPath() || !newRetailPath()) {
      await showMessage("Select edited and new retail files first.", { title: "Save Blocked", kind: "warning" });
      return;
    }

    const sourcePath = editedPath();
    const autoPaths = buildAutoSavePaths(sourcePath, getProjectFolder());
    if (!autoPaths) {
      await showMessage(
        "Set Project Folder and use files under a ROM path (for example ROM/2/13.DAT) so save can be auto-routed.",
        { title: "Project Folder Required", kind: "warning" },
      );
      return;
    }

    const outYamlPath = autoPaths.yamlPath;
    const outDatPath: string | null = autoPaths.datPath;
    const normalizedRetailPath = normalizePathForCompare(newRetailPath());
    const writesToRetailFile =
      normalizePathForCompare(outYamlPath) === normalizedRetailPath ||
      (!!outDatPath && normalizePathForCompare(outDatPath) === normalizedRetailPath);
    if (writesToRetailFile) {
      await showMessage("Refusing to save: output path resolves to the selected New Retail file.", { title: "Save Blocked", kind: "error" });
      return;
    }

    const payloadRows = rows.map((row) => ({ ...row }));

    setSaving(true);
    try {
      const result = unwrap(
        await saveEntityNameDiff(payloadRows, outYamlPath, outDatPath),
      );
      setLastSavedYamlPath(result.out_yaml_path);
      setLastSavedDatPath(result.out_dat_path ?? "");
      setLastNotice(`Saved ${result.written_count} entries.`);
      await showMessage(
        `Saved ${result.written_count} entries.\nYAML: ${result.out_yaml_path}${result.out_dat_path ? `\nDAT: ${result.out_dat_path}` : ""}`,
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
      <h1>Entity Diff</h1>
      <hr />

      <div class="mt-3 flex flex-col gap-3">
        <div class="flex flex-row gap-2 items-center">
          <button
            class={compactButtonClass()}
            onclick={() => pickFile(setEditedFile, pickerDefaultPath(editedPath(), getOutputRoot(getProjectFolder())))}
          >
            Edited DAT/YAML
          </button>
          <span class="font-mono text-sm">{editedPath() || "Not selected"}</span>
        </div>

        <div class="flex flex-row gap-2 items-center">
          <button
            class={compactButtonClass()}
            onclick={() => pickFile(setNewRetailFile, pickerDefaultPath(newRetailPath(), getDatFolder()))}
          >
            New Retail DAT/YAML
          </button>
          <span class="font-mono text-sm">{newRetailPath() || "Not selected"}</span>
        </div>

        <div class="text-xs text-slate-400">
          New Retail is read-only input. Save merged only writes to your edited-side output.
        </div>

        <div class="flex flex-row gap-2 items-center">
          <button class={compactButtonClass()} disabled={isComparing()} onclick={runCompare}>
            {isComparing() ? "Comparing..." : "Compare"}
          </button>

          <button
            class={compactButtonClass(showChangedOnly())}
            disabled={rows.length === 0}
            onclick={() => setShowChangedOnly(!showChangedOnly())}
          >
            {showChangedOnly() ? "Showing changed rows" : "Showing all rows"}
          </button>

          <button
            class={compactButtonClass(manualEdit())}
            disabled={rows.length === 0}
            onclick={() => setManualEdit(!manualEdit())}
          >
            {manualEdit() ? "Manual edit: ON" : "Manual edit: OFF"}
          </button>

          <button
            class={compactButtonClass()}
            disabled={isSaving() || rows.length === 0}
            onclick={saveMerged}
          >
            {isSaving() ? "Saving..." : "Save merged"}
          </button>
        </div>

        <Show when={lastNotice()}>
          <div class="text-sm italic text-slate-300">{lastNotice()}</div>
        </Show>

        <Show when={lastSavedYamlPath()}>
          <div class="text-sm">
            Last saved YAML: <span class="font-mono text-green-200">{lastSavedYamlPath()}</span>
          </div>
        </Show>

        <Show when={lastSavedDatPath()}>
          <div class="text-sm">
            Last saved DAT: <span class="font-mono text-green-200">{lastSavedDatPath()}</span>
          </div>
        </Show>

        <Show when={rows.length > 0}>
          <div class="text-sm text-slate-300">
            Edited entries: {oldCount()} | New retail entries: {newCount()} | Changed rows: {changedCount()} | Changed rows set to OLD: {changedRowsSelectedOld()}
          </div>

          <div class="flex flex-row justify-between items-center gap-3">
            <div class="flex flex-row gap-2">
              <button class={compactButtonClass()} onclick={() => applyBulkChoice("Old", true)}>
                Keep all Old
              </button>
              <button class={compactButtonClass()} onclick={() => applyBulkChoice("New", true)}>
                Keep all New
              </button>
              <button class={compactButtonClass()} disabled={rows.length === 0} onclick={keepAllNewIds}
              >
                Keep all new IDs
              </button>
            </div>
            <input
              class="m-0 w-64 max-w-[42vw] py-0.5 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
              placeholder="Search rows..."
              value={tableFilter()}
              onInput={(e) => setTableFilter(e.currentTarget.value)}
            />
          </div>

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
                  <th>Row</th>
                  <th>Edited ID</th>
                  <th>Edited Name</th>
                  <th>New ID</th>
                  <th>New Name</th>
                  <th>Target ID</th>
                  <th>Keep</th>
                </tr>
              </thead>
              <tbody>
                <Show when={virtualWindow().topPadding > 0}>
                  <tr>
                    <td colSpan={ENTITY_DIFF_COLUMN_COUNT} style={{ height: `${virtualWindow().topPadding}px`, padding: "0", border: "0" }}></td>
                  </tr>
                </Show>
                <For each={visibleRows()}>
                  {(row) => (
                    <tr class={isChangedRow(row) ? "bg-slate-700/40" : ""}>
                      <td>{row.row}</td>
                      <td class="font-mono">{row.old_id ?? "-"}</td>
                      <td>{row.old_name ?? "-"}</td>
                      <td class={`font-mono ${newFieldClass(row.old_id !== row.new_id)}`}>
                        <Show
                          when={manualEdit()}
                          fallback={<>{row.new_id ?? "-"}</>}
                        >
                          <input
                            class={`hide-spin-buttons m-0 !w-[12ch] min-w-[12ch] max-w-[12ch] py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_id !== row.new_id)}`}
                            type="number"
                            min={0}
                            step={1}
                            value={row.new_id ?? ""}
                            onInput={(e) => setRowNewId(row.row, e.currentTarget.value)}
                          />
                        </Show>
                      </td>
                      <td class={newFieldClass(row.old_name !== row.new_name)}>
                        <Show
                          when={manualEdit()}
                          fallback={<>{row.new_name ?? "-"}</>}
                        >
                          <input
                            class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_name !== row.new_name)}`}
                            type="text"
                            value={row.new_name ?? ""}
                            onInput={(e) => setRowNewName(row.row, e.currentTarget.value)}
                          />
                        </Show>
                      </td>
                      <td>
                        <select
                          class="m-0 !w-[12ch] min-w-[12ch] max-w-[12ch] py-0 px-2 text-sm font-mono rounded-md bg-slate-800 border border-slate-500 focus:border-slate-300 focus:outline-none"
                          value={row.target_id ?? defaultTargetForRow(row) ?? undefined}
                          onChange={(e) => {
                            setRowTargetId(row.row, Number(e.currentTarget.value));
                          }}
                        >
                          <For each={targetOptionsForRow(row)}>
                            {(id) => <option value={id}>{id}</option>}
                          </For>
                        </select>
                      </td>
                      <td>
                        <div class="flex flex-row gap-2">
                          <button
                            class={compactButtonClass(row.choice === "Old")}
                            disabled={row.old_id === null || row.old_name === null}
                            onclick={() => setRowChoice(row.row, "Old")}
                          >
                            Old
                          </button>
                          <button
                            class={compactButtonClass(row.choice === "New")}
                            disabled={row.new_id === null || row.new_name === null}
                            onclick={() => setRowChoice(row.row, "New")}
                          >
                            New
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
                <Show when={virtualWindow().bottomPadding > 0}>
                  <tr>
                    <td colSpan={ENTITY_DIFF_COLUMN_COUNT} style={{ height: `${virtualWindow().bottomPadding}px`, padding: "0", border: "0" }}></td>
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

export default EntityDiffTool;
