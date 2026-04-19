import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createDeferred, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  EntityDiffChoice,
  EntityDiffRow,
  compareItemFiles,
  saveItemDiff,
} from "../custom_bindings";
import { useData } from "../store";
import { unwrap } from "../util";

function arraysEqual(a: string[] | null | undefined, b: string[] | null | undefined) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function isChangedRow(row: EntityDiffRow) {
  const flagsChanged = !arraysEqual(row.old_flags, row.new_flags);
  const jobsChanged = !arraysEqual(row.old_jobs, row.new_jobs);

  return (
    row.old_id !== row.new_id ||
    row.old_name !== row.new_name ||
    row.old_stack_size !== row.new_stack_size ||
    row.old_description !== row.new_description ||
    flagsChanged ||
    jobsChanged ||
    row.old_id === null ||
    row.new_id === null
  );
}

function newFieldClass(changed: boolean) {
  return changed ? "bg-rose-950/35 text-rose-200" : "bg-emerald-950/35 text-emerald-200";
}

function retailDiffValueClass(changed: boolean) {
  return changed
    ? "rounded px-2 py-0.5 bg-amber-950/35 text-amber-200"
    : "text-slate-100";
}

function retailDiffPanelClass(changed: boolean) {
  return changed
    ? "border border-amber-700/60 bg-amber-950/10 rounded-md p-2"
    : "border border-slate-700 rounded-md p-2";
}

function retailListValueClass(kind: "same" | "current-only" | "retail-only") {
  if (kind === "current-only") {
    return "text-sm py-0.5 bg-amber-950/35 text-amber-200";
  }
  if (kind === "retail-only") {
    return "text-sm py-0.5 bg-sky-950/35 text-sky-200";
  }
  return "text-sm text-slate-100";
}

function defaultChoiceForRow(row: EntityDiffRow): EntityDiffChoice {
  if (row.old_id !== null && row.old_name !== null) {
    return "Old";
  }
  return "New";
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

function fileExtension(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf(".");
  if (idx < 0) {
    return "";
  }
  return normalized.slice(idx + 1).toLowerCase();
}

function normalizePathForCompare(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
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

function getCustomOutputRoot(localEditRoot: string | null): string | null {
  if (!localEditRoot) {
    return null;
  }

  return localEditRoot.replaceAll("\\", "/").replace(/\/+$/, "");
}

function buildAutoSavePaths(
  sourcePath: string,
  localEditRoot: string | null,
): { yamlPath: string; datPath: string } | null {
  const outputRoot = getCustomOutputRoot(localEditRoot);
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

const compactButtonBaseClass = "my-0 px-2 py-0.5 text-sm font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
const compactButtonActiveClass = "bg-green-800 border-green-500 text-slate-100";
const ITEM_DIFF_STATE_KEY = "xi_tinkerer_item_diff_state_v1";
const ITEM_DIFF_COLUMN_COUNT = 4;
const VIRTUAL_ROW_HEIGHT_PX = 34;
const VIRTUAL_OVERSCAN_ROWS = 16;
const ITEM_FLAG_OPTIONS = [
  "Ex",
  "WallHanging",
  "Flag01",
  "MysteryBox",
  "MogGarden",
  "CanSendPOL",
  "Inscribable",
  "NoAuction",
  "Scroll",
  "Linkshell",
  "CanUse",
  "CanTradeNPC",
  "CanEquip",
  "NoSale",
  "NoDelivery",
  "NoTradePC",
  "Rare",
];
const ITEM_JOB_OPTIONS = [
  "All",
  "BLM",
  "BLU",
  "BRD",
  "BST",
  "COR",
  "DNC",
  "DRG",
  "DRK",
  "GEO",
  "MNK",
  "NIN",
  "PLD",
  "PUP",
  "RDM",
  "RNG",
  "RUN",
  "SAM",
  "SCH",
  "SMN",
  "THF",
  "WAR",
  "WHM",
];

interface ItemDiffCachedState {
  edited_path: string;
  new_retail_path: string;
  rows: EntityDiffRow[];
  retail_snapshot_by_row?: Record<number, ItemDiffRetailSnapshot>;
  old_count: number;
  new_count: number;
  changed_count: number;
  show_changed_only: boolean;
  table_filter: string;
  manual_edit: boolean;
  selected_row: number | null;
  last_notice: string;
  last_saved_yaml_path: string;
  last_saved_dat_path: string;
}

interface ItemDiffRetailSnapshot {
  has_retail_entry: boolean;
  id: number | null;
  name: string | null;
  stack_size: number | null;
  flags: string[] | null;
  jobs: string[] | null;
  description: string | null;
}

function isRetailChangedRow(row: EntityDiffRow, retailSnapshot?: ItemDiffRetailSnapshot | null) {
  const retailId = retailSnapshot?.id ?? row.new_id;
  const retailName = retailSnapshot?.name ?? row.new_name;
  const retailStackSize = retailSnapshot?.stack_size ?? row.new_stack_size;
  const retailFlags = retailSnapshot?.flags ?? normalizedStringList(row.new_flags);
  const retailJobs = retailSnapshot?.jobs ?? normalizedStringList(row.new_jobs);
  const retailDescription = retailSnapshot?.description ?? row.new_description ?? null;

  return (
    row.old_id !== retailId ||
    row.old_name !== retailName ||
    row.old_stack_size !== retailStackSize ||
    !arraysEqual(normalizedStringList(row.old_flags), retailFlags) ||
    !arraysEqual(normalizedStringList(row.old_jobs), retailJobs) ||
    (row.old_description ?? null) !== retailDescription
  );
}

function computeRetailChangedRowIds(rows: EntityDiffRow[], retailSnapshotByRow: Record<number, ItemDiffRetailSnapshot>) {
  return new Set(
    rows
      .filter((row) => isRetailChangedRow(row, retailSnapshotByRow[row.row]))
      .map((row) => row.row),
  );
}

function compactButtonClass(active = false) {
  return `${compactButtonBaseClass} ${active ? compactButtonActiveClass : compactButtonIdleClass}`;
}

function pickerDefaultPath(currentPath: string, fallbackDir: string | null) {
  if (!currentPath) {
    return fallbackDir ?? undefined;
  }

  const { dir } = splitPath(currentPath);
  return dir || fallbackDir || undefined;
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

  const { dir: romDir, file: romFile } = splitPath(romRelativePath);
  const retailFile = replaceExt(romFile, ".DAT");
  const normalizedRoot = ffxiRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return romDir
    ? `${normalizedRoot}/${romDir}/${retailFile}`
    : `${normalizedRoot}/${retailFile}`;
}

function loadCachedState(): ItemDiffCachedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(ITEM_DIFF_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as ItemDiffCachedState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function rowSearchText(row: EntityDiffRow) {
  return [
    row.row,
    row.old_id,
    row.old_name,
    row.old_stack_size,
    row.old_description,
    row.new_id,
    row.new_name,
    row.new_stack_size,
    row.new_description,
    ...(row.old_flags ?? []),
    ...(row.new_flags ?? []),
    ...(row.old_jobs ?? []),
    ...(row.new_jobs ?? []),
    row.choice,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => `${value}`.toLowerCase())
    .join(" ");
}

function normalizedStringList(values: string[] | null | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0))).sort();
}

function ItemDiffTool() {
  const {
    folders: { getDatFolder, getLocalEditFolder },
  } = useData();
  const [searchParams] = useSearchParams();
  const cachedState = loadCachedState();

  const [editedPath, setEditedPath] = createSignal(cachedState?.edited_path ?? "");
  const [newRetailPath, setNewRetailPath] = createSignal(cachedState?.new_retail_path ?? "");

  const [rows, setRows] = createStore<EntityDiffRow[]>(cachedState?.rows ?? []);
  const [retailSnapshotByRow, setRetailSnapshotByRow] = createSignal<Record<number, ItemDiffRetailSnapshot>>(
    cachedState?.retail_snapshot_by_row ?? {},
  );
  const [oldCount, setOldCount] = createSignal(cachedState?.old_count ?? 0);
  const [newCount, setNewCount] = createSignal(cachedState?.new_count ?? 0);
  const [changedCount, setChangedCount] = createSignal(cachedState?.changed_count ?? 0);

  const [isComparing, setComparing] = createSignal(false);
  const [isSaving, setSaving] = createSignal(false);
  const [showChangedOnly, setShowChangedOnly] = createSignal(cachedState?.show_changed_only ?? true);
  const [tableFilter, setTableFilter] = createSignal(cachedState?.table_filter ?? "");
  const deferredTableFilter = createDeferred(() => tableFilter());
  const [manualEdit, setManualEdit] = createSignal(cachedState?.manual_edit ?? true);
  const [bulkFlagToRemove, setBulkFlagToRemove] = createSignal(ITEM_FLAG_OPTIONS[0]);
  const [bulkJobToRemove, setBulkJobToRemove] = createSignal(ITEM_JOB_OPTIONS[0]);
  const [selectedRowId, setSelectedRowId] = createSignal<number | null>(cachedState?.selected_row ?? null);
  const [prefillApplied, setPrefillApplied] = createSignal(false);
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [lastSavedYamlPath, setLastSavedYamlPath] = createSignal(cachedState?.last_saved_yaml_path ?? "");
  const [lastSavedDatPath, setLastSavedDatPath] = createSignal(cachedState?.last_saved_dat_path ?? "");
  const [scrollTop, setScrollTop] = createSignal(0);
  const [tableViewportHeight, setTableViewportHeight] = createSignal(480);
  const changedRowIds = createMemo(() => computeRetailChangedRowIds(rows, retailSnapshotByRow()));

  let tableContainerRef: HTMLDivElement | undefined;
  let scrollFrame = 0;

  const changedRowsSelectedOld = createMemo(() => {
    const changed = changedRowIds();
    return rows.filter((row) => changed.has(row.row) && row.choice === "Old").length;
  });

  const rowSearchIndex = createMemo(() => {
    const index = new Map<number, string>();
    for (const row of rows) {
      index.set(row.row, rowSearchText(row));
    }
    return index;
  });

  const displayedRows = createMemo(() => {
    const filterText = deferredTableFilter().trim().toLowerCase();
    const changed = changedRowIds();
    const baseRows = showChangedOnly() ? rows.filter((row) => changed.has(row.row)) : rows;
    if (!filterText) {
      return baseRows;
    }

    const searchIndex = rowSearchIndex();
    return baseRows.filter((row) => (searchIndex.get(row.row) ?? "").includes(filterText));
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

  const allFlagOptions = createMemo(() => {
    const discovered = new Set<string>(ITEM_FLAG_OPTIONS);
    for (const row of rows) {
      for (const flag of row.old_flags ?? []) {
        discovered.add(flag);
      }
      for (const flag of row.new_flags ?? []) {
        discovered.add(flag);
      }
    }
    return Array.from(discovered).sort();
  });

  const allJobOptions = createMemo(() => {
    const discovered = new Set<string>(ITEM_JOB_OPTIONS);
    for (const row of rows) {
      for (const job of row.old_jobs ?? []) {
        discovered.add(job);
      }
      for (const job of row.new_jobs ?? []) {
        discovered.add(job);
      }
    }
    return Array.from(discovered).sort();
  });

  const selectedRow = createMemo(() => {
    const rowId = selectedRowId();
    if (rowId === null) {
      return null;
    }
    return rows.find((row) => row.row === rowId) ?? null;
  });

  createEffect(() => {
    const options = allFlagOptions();
    if (options.length === 0) {
      return;
    }

    const current = bulkFlagToRemove();
    if (!options.includes(current)) {
      setBulkFlagToRemove(options[0]);
    }
  });

  createEffect(() => {
    const options = allJobOptions();
    if (options.length === 0) {
      return;
    }

    const current = bulkJobToRemove();
    if (!options.includes(current)) {
      setBulkJobToRemove(options[0]);
    }
  });

  const resetLoadedRows = () => {
    setRows([]);
    setRetailSnapshotByRow({});
    setOldCount(0);
    setNewCount(0);
    setChangedCount(0);
    setSelectedRowId(null);
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
    if (rows.length === 0) {
      if (selectedRowId() !== null) {
        setSelectedRowId(null);
      }
      return;
    }

    const currentSelected = selectedRowId();
    if (currentSelected === null || !rows.some((row) => row.row === currentSelected)) {
      setSelectedRowId(rows[0].row);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stateToSave: ItemDiffCachedState = {
      edited_path: editedPath(),
      new_retail_path: newRetailPath(),
      rows: rows.map((row) => ({ ...row })),
      retail_snapshot_by_row: retailSnapshotByRow(),
      old_count: oldCount(),
      new_count: newCount(),
      changed_count: changedCount(),
      show_changed_only: showChangedOnly(),
      table_filter: tableFilter(),
      manual_edit: manualEdit(),
      selected_row: selectedRowId(),
      last_notice: lastNotice(),
      last_saved_yaml_path: lastSavedYamlPath(),
      last_saved_dat_path: lastSavedDatPath(),
    };

    window.sessionStorage.setItem(ITEM_DIFF_STATE_KEY, JSON.stringify(stateToSave));
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
      await message("Select edited and new retail item files first.");
      return;
    }

    setComparing(true);
    try {
      const result = unwrap(await compareItemFiles(editedPath(), newRetailPath()));
      const nextRetailSnapshotByRow: Record<number, ItemDiffRetailSnapshot> = {};
      for (const row of result.rows) {
        nextRetailSnapshotByRow[row.row] = {
          has_retail_entry: row.new_id !== null || row.new_name !== null,
          id: row.new_id ?? null,
          name: row.new_name ?? null,
          stack_size: row.new_stack_size ?? null,
          flags: row.new_flags ? normalizedStringList(row.new_flags) : null,
          jobs: row.new_jobs ? normalizedStringList(row.new_jobs) : null,
          description: row.new_description ?? null,
        };
      }
      const preparedRows = result.rows.map((row) => ({
        ...row,
        choice: defaultChoiceForRow(row),
        old_flags: normalizedStringList(row.old_flags),
        // Editable add/remove should default to the currently edited DAT side.
        new_flags: normalizedStringList(row.old_flags ?? row.new_flags),
        old_jobs: normalizedStringList(row.old_jobs),
        // Editable add/remove should default to the currently edited DAT side.
        new_jobs: normalizedStringList(row.old_jobs ?? row.new_jobs),
        old_description: row.old_description ?? null,
        // Editable description should default to the currently edited DAT side.
        new_description: row.old_description ?? row.new_description ?? null,
      }));
      batch(() => {
        setRows(() => preparedRows);
        setRetailSnapshotByRow(nextRetailSnapshotByRow);
        setOldCount(result.old_count);
        setNewCount(result.new_count);
        setChangedCount(result.changed_count);
        setSelectedRowId(preparedRows[0]?.row ?? null);
        setLastNotice(`Loaded ${result.changed_count} changed row(s).`);
      });
    } catch (err) {
      await message(`${err}`);
    } finally {
      setComparing(false);
    }
  };

  const updateRowById = (rowId: number, updater: (row: EntityDiffRow) => void) => {
    setRows(produce((draft) => {
      const row = draft.find((entry) => entry.row === rowId);
      if (!row) {
        return;
      }
      updater(row);
    }));
  };

  const selectRow = (rowId: number) => {
    setSelectedRowId(Number(rowId));
    setManualEdit(true);
  };

  const setRowChoice = (rowId: number, choice: EntityDiffChoice) => {
    updateRowById(rowId, (row) => {
      row.choice = choice;
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
      row.new_id = newId;
      row.choice = "New";
    });
  };

  const setRowNewName = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_name = value;
      row.choice = "New";
    });
  };

  const setRowNewStackSize = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const newStackSize = Math.trunc(parsed);
    if (newStackSize < 0) {
      return;
    }

    updateRowById(rowId, (row) => {
      row.new_stack_size = newStackSize;
      row.choice = "New";
    });
  };

  const setRowNewFlags = (rowId: number, flags: string[]) => {
    const nextFlags = normalizedStringList(flags);
    updateRowById(rowId, (row) => {
      row.new_flags = nextFlags;
      row.choice = "New";
    });
  };

  const setRowNewJobs = (rowId: number, jobs: string[]) => {
    const nextJobs = normalizedStringList(jobs);
    updateRowById(rowId, (row) => {
      row.new_jobs = nextJobs;
      row.choice = "New";
    });
  };

  const setRowNewDescription = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_description = value;
      row.choice = "New";
    });
  };

  const toggleRowNewFlag = (rowId: number, flag: string, enabled: boolean) => {
    const row = rows.find((entry) => entry.row === rowId);
    const current = new Set(normalizedStringList(row?.new_flags ?? row?.old_flags));
    if (enabled) {
      current.add(flag);
    } else {
      current.delete(flag);
    }
    setRowNewFlags(rowId, Array.from(current));
  };


  const toggleRowNewJob = (rowId: number, job: string, enabled: boolean) => {
    const row = rows.find((entry) => entry.row === rowId);
    const current = normalizedStringList(row?.new_jobs ?? row?.old_jobs);
    const knownJobOptions = new Set(ITEM_JOB_OPTIONS);
    const hiddenJobs = current.filter((entry) => !knownJobOptions.has(entry));
    const knownJobs = new Set(current.filter((entry) => knownJobOptions.has(entry)));

    if (job === "All") {
      knownJobs.clear();
      if (enabled) {
        knownJobs.add("All");
      }
    } else {
      knownJobs.delete("All");
      if (enabled) {
        knownJobs.add(job);
      } else {
        knownJobs.delete(job);
      }
    }

    setRowNewJobs(rowId, [...hiddenJobs, ...Array.from(knownJobs)]);
  };


  const applyBulkChoice = (choice: EntityDiffChoice, onlyChanged: boolean) => {
    const changed = changedRowIds();
    setRows(produce((draft) => {
      for (const row of draft) {
        if (onlyChanged && !changed.has(row.row)) {
          continue;
        }

        if (choice === "Old" && row.old_id !== null && row.old_name !== null) {
          row.choice = "Old";
        } else if (choice === "New" && row.new_id !== null && row.new_name !== null) {
          row.choice = "New";
        }

      }
    }));
  };

  const removeFlagFromAllItems = async () => {
    if (rows.length === 0) {
      await message("Compare files first so there are rows to update.");
      return;
    }

    const flag = bulkFlagToRemove().trim();
    if (!flag) {
      await message("Pick a flag first.");
      return;
    }

    const confirmed = await ask(
      `Danger: Remove "${flag}" from every loaded item row?\n\nThis applies globally and can change many items at once.`,
      {
        title: "Global Flag Removal",
        kind: "warning",
        okLabel: "Remove",
        cancelLabel: "Cancel",
      },
    );
    if (confirmed !== true) {
      setLastNotice(`Cancelled global removal for "${flag}".`);
      return;
    }

    let affectedRows = 0;
    setRows(produce((draft) => {
      for (const row of draft) {
        let rowChanged = false;
        const currentEditableFlags = normalizedStringList(row.new_flags ?? row.old_flags);
        const nextEditableFlags = currentEditableFlags.filter((entry) => entry !== flag);
        if (nextEditableFlags.length !== currentEditableFlags.length) {
          row.new_flags = nextEditableFlags;
          rowChanged = true;
        }

        if (rowChanged) {
          row.choice = "New";
          affectedRows += 1;
        }
      }
    }));

    setLastNotice(`Unchecked "${flag}" on editable side for ${affectedRows} row(s). Review and Save merged.`);
  };

  const removeJobFromAllItems = async () => {
    if (rows.length === 0) {
      await message("Compare files first so there are rows to update.");
      return;
    }

    const job = bulkJobToRemove().trim();
    if (!job) {
      await message("Pick a job first.");
      return;
    }

    const confirmed = await ask(
      `Danger: Remove "${job}" from every loaded item row?\n\nThis applies globally and can change many items at once.`,
      {
        title: "Global Job Removal",
        kind: "warning",
        okLabel: "Remove",
        cancelLabel: "Cancel",
      },
    );
    if (confirmed !== true) {
      setLastNotice(`Cancelled global removal for "${job}".`);
      return;
    }

    let affectedRows = 0;
    setRows(produce((draft) => {
      for (const row of draft) {
        let rowChanged = false;
        const currentEditableJobs = normalizedStringList(row.new_jobs ?? row.old_jobs);
        const nextEditableJobs = currentEditableJobs.filter((entry) => entry !== job);
        if (nextEditableJobs.length !== currentEditableJobs.length) {
          row.new_jobs = nextEditableJobs;
          rowChanged = true;
        }

        if (rowChanged) {
          row.choice = "New";
          affectedRows += 1;
        }
      }
    }));

    setLastNotice(`Unchecked "${job}" on editable side for ${affectedRows} row(s). Review and Save merged.`);
  };

  const saveMerged = async () => {
    if (rows.length === 0) {
      await message("Compare files first so there is something to save.");
      return;
    }

    if (!editedPath() || !newRetailPath()) {
      await message("Select edited and new retail item files first.");
      return;
    }

    const sourcePath = editedPath();
    const autoPaths = buildAutoSavePaths(sourcePath, getLocalEditFolder());
    if (!autoPaths) {
      await message(
        "Set Custom DAT Root and use files under a ROM path (for example ROM/2/13.DAT) so save can be auto-routed.",
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
      await message("Refusing to save: output path resolves to the selected New Retail file.");
      return;
    }

    const payloadRows = rows.map((row) => ({ ...row }));

    setSaving(true);
    try {
      const result = unwrap(
        await saveItemDiff(editedPath(), newRetailPath(), payloadRows, outYamlPath, outDatPath),
      );
      const preferredEditedPath =
        fileExtension(editedPath()) === "dat" && result.out_dat_path
          ? result.out_dat_path
          : result.out_yaml_path;

      setLastSavedYamlPath(result.out_yaml_path);
      setLastSavedDatPath(result.out_dat_path ?? "");
      if (preferredEditedPath) {
        setEditedPath(preferredEditedPath);
      }
      setLastNotice(
        `Saved ${result.written_count} entries. Edited source now points to: ${preferredEditedPath}`,
      );
      await message(
        `Saved ${result.written_count} entries.\nYAML: ${result.out_yaml_path}${result.out_dat_path ? `\nDAT: ${result.out_dat_path}` : ""}`,
      );
    } catch (err) {
      await message(`${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="w-full">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <h1 class="m-0">Item Diff</h1>
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
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <div class="min-w-0 flex items-center gap-2">
              <button
                class={`${compactButtonClass()} whitespace-nowrap`}
                onClick={() => pickFile(
                  setEditedFile,
                  pickerDefaultPath(editedPath(), getLocalEditFolder()),
                )}
              >
                Edited DAT/YAML
              </button>
              <span class="font-mono text-xs truncate" title={editedPath() || "Not selected"}>
                {editedPath() || "Not selected"}
              </span>
            </div>

            <div class="min-w-0 flex items-center gap-2">
              <button
                class={`${compactButtonClass()} whitespace-nowrap`}
                onClick={() => pickFile(
                  setNewRetailFile,
                  pickerDefaultPath(newRetailPath(), getDatFolder()),
                )}
              >
                New Retail DAT/YAML
              </button>
              <span class="font-mono text-xs truncate" title={newRetailPath() || "Not selected"}>
                {newRetailPath() || "Not selected"}
              </span>
            </div>
          </div>

          <div class="text-[11px] text-slate-400">
            New Retail is read-only input. Save merged only writes to your edited-side output.
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class={compactButtonClass()} disabled={isComparing()} onClick={runCompare}>
              {isComparing() ? "Comparing..." : "Compare"}
            </button>

            <button
              class={compactButtonClass(showChangedOnly())}
              disabled={rows.length === 0}
              onClick={() => setShowChangedOnly(!showChangedOnly())}
            >
              {showChangedOnly() ? "Showing diff rows" : "Showing all rows"}
            </button>

            <button
              class={compactButtonClass(manualEdit())}
              disabled={rows.length === 0}
              onClick={() => setManualEdit(!manualEdit())}
            >
              {manualEdit() ? "Manual edit: ON" : "Manual edit: OFF"}
            </button>

            <button
              class={compactButtonClass()}
              disabled={isSaving() || rows.length === 0}
              onClick={saveMerged}
            >
              {isSaving() ? "Saving..." : "Save merged"}
            </button>

          </div>

          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
            <Show when={lastNotice()}>
              <div class="italic text-slate-300">{lastNotice()}</div>
            </Show>
            <Show when={rows.length > 0}>
              <div class="text-slate-300">
                Edited: {oldCount()} | Retail: {newCount()} | Changed: {changedCount()} | Keep OLD: {changedRowsSelectedOld()}
              </div>
            </Show>
          </div>
        </div>

        <Show when={rows.length > 0}>

          <div class="rounded-md border border-rose-700/60 bg-rose-950/15 px-3 py-2">
            <div class="text-xs font-semibold uppercase tracking-wide text-rose-200">Danger Zone</div>
            <div class="text-xs text-rose-300">
              Bulk removals only affect the editable side. Nothing is written until you click Save merged.
            </div>
            <div class="mt-2 flex flex-wrap items-end gap-2">
              <div class="flex items-center gap-2">
                <span class="text-xs text-rose-200 whitespace-nowrap">Remove Flag</span>
                <select
                  class="m-0 min-w-[9rem] py-0 px-2 text-sm rounded-md bg-slate-800 border border-slate-500 focus:border-slate-300 focus:outline-none"
                  value={bulkFlagToRemove()}
                  onChange={(e) => setBulkFlagToRemove(e.currentTarget.value)}
                >
                  <For each={allFlagOptions()}>
                    {(flag) => <option value={flag}>{flag}</option>}
                  </For>
                </select>
                <button
                  class="my-0 px-2 py-0.5 text-sm font-normal rounded-md border border-rose-500 bg-rose-900 text-rose-100 hover:border-rose-300 disabled:text-slate-600 disabled:border-slate-600"
                  disabled={rows.length === 0}
                  onClick={removeFlagFromAllItems}
                >
                  Remove From All
                </button>
              </div>

              <div class="flex items-center gap-2">
                <span class="text-xs text-rose-200 whitespace-nowrap">Remove Job</span>
                <select
                  class="m-0 min-w-[9rem] py-0 px-2 text-sm rounded-md bg-slate-800 border border-slate-500 focus:border-slate-300 focus:outline-none"
                  value={bulkJobToRemove()}
                  onChange={(e) => setBulkJobToRemove(e.currentTarget.value)}
                >
                  <For each={allJobOptions()}>
                    {(job) => <option value={job}>{job}</option>}
                  </For>
                </select>
                <button
                  class="my-0 px-2 py-0.5 text-sm font-normal rounded-md border border-rose-500 bg-rose-900 text-rose-100 hover:border-rose-300 disabled:text-slate-600 disabled:border-slate-600"
                  disabled={rows.length === 0}
                  onClick={removeJobFromAllItems}
                >
                  Remove From All
                </button>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-[minmax(300px,0.85fr)_minmax(520px,1.35fr)] gap-3">
            <div
              class="max-h-[70vh] overflow-auto border border-slate-700 rounded-md"
              ref={(el) => {
                tableContainerRef = el;
              }}
              onScroll={onTableScroll}
            >
              <table class="w-full table-fixed">
                <colgroup>
                  <col class="w-[4.5rem]" />
                  <col class="w-[7.5rem]" />
                  <col />
                  <col class="w-[6rem]" />
                </colgroup>
                <thead class="sticky top-0 z-10">
                  <tr>
                    <th>Row</th>
                    <th>Edited ID</th>
                    <th>Edited Item Name</th>
                    <th>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  <Show when={virtualWindow().topPadding > 0}>
                    <tr>
                      <td colSpan={ITEM_DIFF_COLUMN_COUNT} style={{ height: `${virtualWindow().topPadding}px`, padding: "0", border: "0" }}></td>
                    </tr>
                  </Show>
                  <For each={visibleRows()}>
                    {(row) => (
                      <tr
                        class={`${isRetailChangedRow(row, retailSnapshotByRow()[row.row]) ? "bg-slate-700/40" : ""} ${selectedRowId() === row.row ? "bg-sky-900/35" : ""} cursor-pointer`}
                        onMouseDown={() => selectRow(row.row)}
                        onClick={() => selectRow(row.row)}
                      >
                        <td>{row.row}</td>
                        <td class="font-mono whitespace-nowrap tabular-nums overflow-visible">{row.old_id ?? "-"}</td>
                        <td class="max-w-[18rem] truncate" title={row.old_name ?? "-"}>{row.old_name ?? "-"}</td>
                        <td>
                          <button class={compactButtonClass(selectedRowId() === row.row)} onClick={() => selectRow(row.row)}>
                            Select
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                  <Show when={virtualWindow().bottomPadding > 0}>
                    <tr>
                      <td colSpan={ITEM_DIFF_COLUMN_COUNT} style={{ height: `${virtualWindow().bottomPadding}px`, padding: "0", border: "0" }}></td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </div>

            <div class="border border-slate-700 rounded-md p-3">
              <Show
                when={selectedRow()}
                keyed
                fallback={<div class="text-sm text-slate-300">Select a row to edit detailed fields.</div>}
              >
                {(row) => {
                  const rowId = row.row;
                  const retailSnapshot = () => retailSnapshotByRow()[rowId];
                  const hasRetailEntry = () => retailSnapshot()?.has_retail_entry ?? (row.new_id !== null || row.new_name !== null);
                  const retailId = () => retailSnapshot()?.id ?? row.new_id;
                  const retailName = () => retailSnapshot()?.name ?? row.new_name;
                  const retailStackSize = () => retailSnapshot()?.stack_size ?? row.new_stack_size;
                  const currentFlags = () => normalizedStringList(row.old_flags ?? row.new_flags);
                  const targetFlags = () => normalizedStringList(row.new_flags ?? row.old_flags);
                  const retailFlags = () => normalizedStringList(retailSnapshot()?.flags ?? []);
                  const currentJobs = () => normalizedStringList(row.old_jobs ?? row.new_jobs);
                  const targetJobs = () => normalizedStringList(row.new_jobs ?? row.old_jobs);
                  const retailJobs = () => normalizedStringList(retailSnapshot()?.jobs ?? []);
                  const currentDescription = () => row.new_description ?? row.old_description ?? "";
                  const retailDescription = () => retailSnapshot()?.description ?? "";
                  const editedIconUrl = () => row.old_id !== null
                    ? `https://static.ffxiah.com/images/icon/${row.old_id}.png`
                    : null;
                  const idDiffersFromRetail = () => row.old_id !== retailId();
                  const nameDiffersFromRetail = () => row.old_name !== retailName();
                  const stackDiffersFromRetail = () => row.old_stack_size !== retailStackSize();
                  const flagsDifferFromRetail = () => !arraysEqual(currentFlags(), retailFlags());
                  const jobsDifferFromRetail = () => !arraysEqual(currentJobs(), retailJobs());
                  const descriptionDiffersFromRetail = () => currentDescription() !== retailDescription();
                  const flagOptions = Array.from(new Set([...ITEM_FLAG_OPTIONS, ...(row.old_flags ?? []), ...(row.new_flags ?? [])])).sort();
                  const jobOptions = ITEM_JOB_OPTIONS;
                  const filteredFlagOptions = flagOptions;
                  const filteredJobOptions = jobOptions;
                  const addedFlags = () => targetFlags().filter((flag) => !currentFlags().includes(flag));
                  const removedFlags = () => currentFlags().filter((flag) => !targetFlags().includes(flag));
                  const addedJobs = () => targetJobs().filter((job) => !currentJobs().includes(job));
                  const removedJobs = () => currentJobs().filter((job) => !targetJobs().includes(job));
                  const hasEquipmentJobs = row.old_jobs !== null || row.new_jobs !== null;

                  return (
                    <div class="flex flex-col gap-3">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-sm font-semibold">Row {row.row}: {row.new_name ?? row.old_name ?? "Unknown item"}</div>
                        <input
                          class="m-0 w-56 max-w-[46vw] py-0.5 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                          placeholder="Filter rows..."
                          value={tableFilter()}
                          onInput={(e) => setTableFilter(e.currentTarget.value)}
                        />
                      </div>
                      <Show when={!manualEdit()}>
                        <div class="text-xs text-slate-400">Manual edit is OFF. Turn it on above to edit ID, name, stack, flags, jobs, and description.</div>
                      </Show>

                      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm items-start">
                        <div class={retailDiffPanelClass(idDiffersFromRetail() || nameDiffersFromRetail() || stackDiffersFromRetail())}>
                          <div class="mb-2 flex items-center justify-between">
                            <div class="font-semibold text-slate-200">Edited</div>
                            <button
                              class={compactButtonClass(row.choice === "Old")}
                              disabled={row.old_id === null || row.old_name === null}
                              onClick={() => setRowChoice(rowId, "Old")}
                            >
                              Old
                            </button>
                          </div>
                          <div class="flex items-start gap-3">
                            <Show when={editedIconUrl()}>
                              <img
                                src={editedIconUrl()!}
                                alt=""
                                class="h-10 w-10 shrink-0 rounded-sm border border-slate-700 bg-slate-900 object-contain"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </Show>

                            <div class="grid min-w-0 flex-1 grid-cols-[8rem_minmax(0,1fr)] gap-y-1 gap-x-2">
                              <div class="text-slate-300">ID:</div>
                              <div class={`font-mono ${retailDiffValueClass(idDiffersFromRetail())}`}>{row.old_id ?? "-"}</div>

                              <div class="text-slate-300">Name:</div>
                              <div class={retailDiffValueClass(nameDiffersFromRetail())}>{row.old_name ?? "-"}</div>

                              <div class="text-slate-300">Stack:</div>
                              <div class={`font-mono ${retailDiffValueClass(stackDiffersFromRetail())}`}>{row.old_stack_size ?? "-"}</div>
                            </div>
                          </div>
                        </div>

                        <div class="border border-slate-700 rounded-md p-2">
                          <div class="mb-2 flex items-center justify-between">
                            <div class="font-semibold text-slate-200">New</div>
                            <button
                              class={compactButtonClass(row.choice === "New")}
                              disabled={row.new_id === null || row.new_name === null}
                              onClick={() => setRowChoice(rowId, "New")}
                            >
                              New
                            </button>
                          </div>
                          <div class="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1 gap-x-2">
                            <div class="text-slate-300">ID:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_id !== row.new_id)}`}
                              type="number"
                              min={0}
                              step={1}
                              disabled={!manualEdit()}
                              value={row.new_id ?? ""}
                              onInput={(e) => setRowNewId(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Name:</div>
                            <input
                              class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_name !== row.new_name)}`}
                              type="text"
                              disabled={!manualEdit()}
                              value={row.new_name ?? ""}
                              onInput={(e) => setRowNewName(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Stack:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_stack_size !== row.new_stack_size)}`}
                              type="number"
                              min={0}
                              step={1}
                              disabled={!manualEdit()}
                              value={row.new_stack_size ?? ""}
                              onInput={(e) => setRowNewStackSize(rowId, e.currentTarget.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div class="border-t border-slate-700 pt-2">
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                          <div class="flex flex-col gap-3">
                            <div class="text-sm font-semibold">Flags</div>
                            <div class={retailDiffPanelClass(flagsDifferFromRetail())}>
                              <div class="mb-2 text-sm font-semibold text-slate-200">Current (read-only)</div>
                              <Show
                                when={currentFlags().length > 0}
                                fallback={<div class="text-sm text-slate-400">No flags set.</div>}
                              >
                                <div class="grid grid-cols-3 gap-x-3 gap-y-1">
                                  <For each={currentFlags()}>
                                    {(flag) => (
                                      <div class={retailListValueClass(retailFlags().includes(flag) ? "same" : "current-only")}>
                                        {flag}
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>

                            <div class={retailDiffPanelClass(flagsDifferFromRetail())}>
                              <div class="mb-2 text-sm font-semibold text-slate-200">Retail (read-only)</div>
                              <Show
                                when={hasRetailEntry()}
                                fallback={<div class="text-sm text-slate-400">Retail row missing for this item.</div>}
                              >
                                <Show
                                  when={retailFlags().length > 0}
                                  fallback={<div class="text-sm text-slate-400">No flags set.</div>}
                                >
                                  <div class="grid grid-cols-3 gap-x-3 gap-y-1">
                                    <For each={retailFlags()}>
                                      {(flag) => (
                                        <div class={retailListValueClass(currentFlags().includes(flag) ? "same" : "retail-only")}>
                                          {flag}
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </Show>
                            </div>

                            <div class="border border-slate-700 rounded-md p-2">
                              <div class="mb-2 text-sm font-semibold text-slate-200">Add / Remove (editable)</div>
                              <div class="mb-2 text-xs text-slate-300">
                                <span class="text-emerald-300">+{addedFlags().length}</span>
                                {" "}added
                                {"  "}
                                <span class="text-rose-300">-{removedFlags().length}</span>
                                {" "}removed
                              </div>
                              <div class="border border-slate-700 rounded-md p-2 grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-x-3 gap-y-1">
                                <For each={filteredFlagOptions}>
                                  {(flag) => (
                                    <label class="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        disabled={!manualEdit()}
                                        checked={targetFlags().includes(flag)}
                                        onChange={(e) => toggleRowNewFlag(rowId, flag, e.currentTarget.checked)}
                                      />
                                      <span class="truncate whitespace-nowrap" title={flag}>{flag}</span>
                                    </label>
                                  )}
                                </For>
                              </div>
                            </div>
                          </div>

                          <div class="flex flex-col gap-3">
                            <div class="text-sm font-semibold">Jobs</div>
                            <Show
                              when={hasEquipmentJobs}
                              fallback={<div class="text-sm text-slate-400">No equipment jobs field on this item.</div>}
                            >
                              <>
                                <div class={retailDiffPanelClass(jobsDifferFromRetail())}>
                                  <div class="mb-2 text-sm font-semibold text-slate-200">Current (read-only)</div>
                                  <Show
                                    when={currentJobs().length > 0}
                                    fallback={<div class="text-sm text-slate-400">No jobs set.</div>}
                                  >
                                    <div class="grid grid-cols-3 gap-x-3 gap-y-1">
                                      <For each={currentJobs()}>
                                        {(job) => (
                                          <div class={retailListValueClass(retailJobs().includes(job) ? "same" : "current-only")}>
                                            {job}
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </div>

                                <div class={retailDiffPanelClass(jobsDifferFromRetail())}>
                                  <div class="mb-2 text-sm font-semibold text-slate-200">Retail (read-only)</div>
                                  <Show
                                    when={hasRetailEntry()}
                                    fallback={<div class="text-sm text-slate-400">Retail row missing for this item.</div>}
                                  >
                                    <Show
                                      when={retailJobs().length > 0}
                                      fallback={<div class="text-sm text-slate-400">No jobs set.</div>}
                                    >
                                      <div class="grid grid-cols-3 gap-x-3 gap-y-1">
                                        <For each={retailJobs()}>
                                          {(job) => (
                                            <div class={retailListValueClass(currentJobs().includes(job) ? "same" : "retail-only")}>
                                              {job}
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                  </Show>
                                </div>

                                <div class="border border-slate-700 rounded-md p-2">
                                  <div class="mb-2 text-sm font-semibold text-slate-200">Add / Remove (editable)</div>
                                  <div class="mb-2 text-xs text-slate-300">
                                    <span class="text-emerald-300">+{addedJobs().length}</span>
                                    {" "}added
                                    {"  "}
                                    <span class="text-rose-300">-{removedJobs().length}</span>
                                    {" "}removed
                                  </div>
                                  <div class="border border-slate-700 rounded-md p-2 grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-x-3 gap-y-1">
                                    <For each={filteredJobOptions}>
                                      {(job) => (
                                        <label class="flex items-center gap-2 text-sm">
                                          <input
                                            type="checkbox"
                                            disabled={!manualEdit()}
                                            checked={targetJobs().includes(job)}
                                            onChange={(e) => toggleRowNewJob(rowId, job, e.currentTarget.checked)}
                                          />
                                          <span class="truncate whitespace-nowrap" title={job}>{job}</span>
                                        </label>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </>
                            </Show>
                          </div>
                        </div>
                      </div>

                      <div class="border-t border-slate-700 pt-2">
                        <div class="flex flex-col gap-3">
                          <div class="text-sm font-semibold">Description</div>
                          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                            <div class={retailDiffPanelClass(descriptionDiffersFromRetail())}>
                              <div class="mb-2 text-sm font-semibold text-slate-200">Current (editable)</div>
                              <textarea
                                class={`m-0 min-h-40 w-full resize-y px-2 py-1 text-sm rounded-md border bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${descriptionDiffersFromRetail() ? "border-amber-500/70" : "border-slate-500"}`}
                                rows={5}
                                disabled={!manualEdit()}
                                value={currentDescription()}
                                onInput={(e) => setRowNewDescription(rowId, e.currentTarget.value)}
                              />
                            </div>

                            <div class={retailDiffPanelClass(descriptionDiffersFromRetail())}>
                              <div class="mb-2 text-sm font-semibold text-slate-200">Retail (read-only)</div>
                              <Show
                                when={hasRetailEntry()}
                                fallback={<div class="text-sm text-slate-400">Retail row missing for this item.</div>}
                              >
                                <textarea
                                  class="m-0 min-h-40 w-full resize-y px-2 py-1 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-100 focus:outline-none"
                                  rows={5}
                                  readonly
                                  value={retailDescription()}
                                />
                              </Show>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default ItemDiffTool;
