import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createDeferred, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { commands, DatDescriptorInfo } from "../bindings";
import {
  EntityDiffChoice,
  ItemDiffRow,
  ItemDiffSaveTarget,
  compareItemFiles,
  saveItemDiff,
} from "../custom_bindings";
import { showConfirm, showMessage } from "../dialogs";
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

type ItemDiffUiRow = ItemDiffRow & {
  old_name?: string | null;
  new_name?: string | null;
  retail_name?: string | null;
  old_description?: string | null;
  new_description?: string | null;
  retail_description?: string | null;
};

function isChangedRow(row: ItemDiffUiRow) {
  const flagsChanged = !arraysEqual(row.old_flags, row.new_flags);
  const jobsChanged = !arraysEqual(row.old_jobs, row.new_jobs);

  return (
    row.old_id !== row.new_id ||
    row.old_en_name !== row.new_en_name ||
    row.old_stack_size !== row.new_stack_size ||
    row.old_level !== row.new_level ||
    (row.old_item_type ?? null) !== (row.new_item_type ?? null) ||
    row.old_shield_size !== row.new_shield_size ||
    row.old_max_charges !== row.new_max_charges ||
    row.old_casting_time !== row.new_casting_time ||
    row.old_use_delay !== row.new_use_delay ||
    row.old_reuse_delay !== row.new_reuse_delay ||
    !arraysEqual(row.old_valid_targets, row.new_valid_targets) ||
    !arraysEqual(row.old_slots, row.new_slots) ||
    (row.old_icon_bytes ?? null) !== (row.new_icon_bytes ?? null) ||
    (row.old_en_description ?? null) !== (row.new_en_description ?? null) ||
    (row.old_jp_name ?? null) !== (row.new_jp_name ?? null) ||
    (row.old_jp_description ?? null) !== (row.new_jp_description ?? null) ||
    flagsChanged ||
    jobsChanged ||
    row.old_id === null ||
    row.new_id === null
  );
}

function newFieldClass(changed: boolean) {
  return changed ? "bg-rose-950/35 text-rose-200" : "bg-emerald-950/35 text-emerald-200";
}

function listChangeTextClass(originalValues: string[], targetValues: string[], value: string) {
  const wasPresent = originalValues.includes(value);
  const isPresent = targetValues.includes(value);
  if (!wasPresent && isPresent) {
    return "text-emerald-200";
  }
  if (wasPresent && !isPresent) {
    return "text-rose-200 line-through decoration-rose-300/80";
  }
  return wasPresent ? "text-slate-100" : "text-slate-400";
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
    return "text-xs py-0.5 bg-amber-950/35 text-amber-200";
  }
  if (kind === "retail-only") {
    return "text-xs py-0.5 bg-sky-950/35 text-sky-200";
  }
  return "text-xs text-slate-100";
}

function defaultChoiceForRow(row: ItemDiffUiRow): EntityDiffChoice {
  if (row.old_id !== null && row.old_en_name !== null) {
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
const ITEM_DIFF_STATE_KEY = "xi_tinkerer_item_diff_state_v1";
const ITEM_DIFF_COLUMN_COUNT = 2;
const VIRTUAL_ROW_HEIGHT_PX = 34;
const VIRTUAL_OVERSCAN_ROWS = 16;
const ITEM_FLAG_OPTIONS = [
  "Ex",
  "WallHanging",
  "GmOnly",
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
const ITEM_TYPE_OPTIONS = [
  "None",
  "Item",
  "QuestItem",
  "Fish",
  "Weapon",
  "Armor",
  "Linkshell",
  "UsableItem",
  "Crystal",
  "Currency",
  "Furnishing",
  "Plant",
  "Flowerpot",
  "PuppetItem",
  "Mannequin",
  "Book",
  "RacingForm",
  "BettingSlip",
  "SoulPlate",
  "Reflector",
  "LotteryTicket",
  "MazeTabulaM",
  "MazeTabulaR",
  "MazeVoucher",
  "MazeRune",
  "StorageSlip",
  "Instinct",
];
const VALID_TARGET_PRESETS = [
  { label: "None", values: [] as string[] },
  { label: "Self", values: ["SelfTarget"] },
  { label: "Player", values: ["Player"] },
  { label: "Party Member", values: ["PartyMember"] },
  { label: "Ally", values: ["Ally"] },
  { label: "NPC", values: ["NPC"] },
  { label: "Enemy", values: ["Enemy"] },
  { label: "Object", values: ["Object"] },
  { label: "Corpse", values: ["Corpse"] },
  { label: "Unknown", values: ["Unknown"] },
];
const SLOT_PRESETS = [
  { label: "None", values: [] as string[] },
  { label: "Main", values: ["Main"] },
  { label: "Sub", values: ["Sub"] },
  { label: "Main + Sub", values: ["Main", "Sub"] },
  { label: "Range", values: ["Range"] },
  { label: "Ammo", values: ["Ammo"] },
  { label: "Head", values: ["Head"] },
  { label: "Body", values: ["Body"] },
  { label: "Hands", values: ["Hands"] },
  { label: "Legs", values: ["Legs"] },
  { label: "Feet", values: ["Feet"] },
  { label: "Neck", values: ["Neck"] },
  { label: "Waist", values: ["Waist"] },
  { label: "Ears", values: ["Ears"] },
  { label: "Rings", values: ["Rings"] },
  { label: "Back", values: ["Back"] },
];

interface ItemDiffCachedState {
  edited_path: string;
  new_retail_path: string;
  old_japanese_path?: string;
  new_japanese_path?: string;
  selected_dat_type?: string;
  rows?: ItemDiffUiRow[];
  retail_snapshot_by_row?: Record<number, ItemDiffRetailSnapshot>;
  old_count: number;
  new_count: number;
  changed_count: number;
  show_changed_only: boolean;
  table_filter: string;
  selected_row: number | null;
  last_notice: string;
  last_saved_yaml_path: string;
  last_saved_dat_path: string;
  last_saved_japanese_yaml_path?: string;
  last_saved_japanese_dat_path?: string;
}

interface ItemDiffRetailSnapshot {
  has_retail_entry: boolean;
  id: number | null;
  name: string | null;
  stack_size: number | null;
  level: number | null;
  item_type: string | null;
  shield_size: number | null;
  max_charges: number | null;
  casting_time: number | null;
  use_delay: number | null;
  reuse_delay: number | null;
  valid_targets: string[] | null;
  slots: string[] | null;
  icon_bytes: string | null;
  flags: string[] | null;
  jobs: string[] | null;
  en_description: string | null;
  jp_name: string | null;
  jp_description: string | null;
}

function isRetailChangedRow(row: ItemDiffUiRow, retailSnapshot?: ItemDiffRetailSnapshot | null) {
  const retailId = retailSnapshot?.id ?? row.retail_id;
  const retailName = retailSnapshot?.name ?? row.retail_en_name;
  const retailStackSize = retailSnapshot?.stack_size ?? row.retail_stack_size;
  const retailLevel = retailSnapshot?.level ?? row.retail_level;
  const retailItemType = retailSnapshot?.item_type ?? row.retail_item_type;
  const retailShieldSize = retailSnapshot?.shield_size ?? row.retail_shield_size;
  const retailMaxCharges = retailSnapshot?.max_charges ?? row.retail_max_charges;
  const retailCastingTime = retailSnapshot?.casting_time ?? row.retail_casting_time;
  const retailUseDelay = retailSnapshot?.use_delay ?? row.retail_use_delay;
  const retailReuseDelay = retailSnapshot?.reuse_delay ?? row.retail_reuse_delay;
  const retailValidTargets = retailSnapshot?.valid_targets ?? normalizedStringList(row.retail_valid_targets);
  const retailSlots = retailSnapshot?.slots ?? normalizedStringList(row.retail_slots);
  const retailIconBytes = retailSnapshot?.icon_bytes ?? row.retail_icon_bytes ?? null;
  const retailFlags = retailSnapshot?.flags ?? normalizedStringList(row.retail_flags);
  const retailJobs = retailSnapshot?.jobs ?? normalizedStringList(row.retail_jobs);
  const retailEnDescription = retailSnapshot?.en_description ?? row.retail_en_description ?? null;
  const retailJpName = retailSnapshot?.jp_name ?? row.retail_jp_name ?? null;
  const retailJpDescription = retailSnapshot?.jp_description ?? row.retail_jp_description ?? null;

  return (
    row.old_id !== retailId ||
    (row.old_en_name ?? null) !== (retailName ?? null) ||
    row.old_stack_size !== retailStackSize ||
    row.old_level !== retailLevel ||
    (row.old_item_type ?? null) !== (retailItemType ?? null) ||
    row.old_shield_size !== retailShieldSize ||
    row.old_max_charges !== retailMaxCharges ||
    row.old_casting_time !== retailCastingTime ||
    row.old_use_delay !== retailUseDelay ||
    row.old_reuse_delay !== retailReuseDelay ||
    !arraysEqual(normalizedStringList(row.old_valid_targets), retailValidTargets) ||
    !arraysEqual(normalizedStringList(row.old_slots), retailSlots) ||
    (row.old_icon_bytes ?? null) !== retailIconBytes ||
    !arraysEqual(normalizedStringList(row.old_flags), retailFlags) ||
    !arraysEqual(normalizedStringList(row.old_jobs), retailJobs) ||
    (row.old_en_description ?? null) !== retailEnDescription ||
    (row.old_jp_name ?? null) !== retailJpName ||
    (row.old_jp_description ?? null) !== retailJpDescription ||
    row.old_id === null ||
    !row.has_retail_entry
  );
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

function rowSearchText(row: ItemDiffUiRow) {
  return [
    row.row,
    row.old_id,
    row.old_en_name,
    row.old_stack_size,
    row.old_level,
    row.old_item_type,
    row.old_shield_size,
    row.old_max_charges,
    row.old_casting_time,
    row.old_use_delay,
    row.old_reuse_delay,
    row.old_en_description,
    row.old_jp_name,
    row.old_jp_description,
    row.new_id,
    row.new_en_name,
    row.new_stack_size,
    row.new_level,
    row.new_item_type,
    row.new_shield_size,
    row.new_max_charges,
    row.new_casting_time,
    row.new_use_delay,
    row.new_reuse_delay,
    row.new_en_description,
    row.new_jp_name,
    row.new_jp_description,
    row.retail_stack_size,
    row.retail_level,
    row.retail_item_type,
    row.retail_shield_size,
    row.retail_max_charges,
    row.retail_casting_time,
    row.retail_use_delay,
    row.retail_reuse_delay,
    row.retail_en_description,
    row.retail_jp_name,
    row.retail_jp_description,
    ...(row.old_flags ?? []),
    ...(row.new_flags ?? []),
    ...(row.retail_flags ?? []),
    ...(row.old_jobs ?? []),
    ...(row.new_jobs ?? []),
    ...(row.retail_jobs ?? []),
    ...(row.old_valid_targets ?? []),
    ...(row.new_valid_targets ?? []),
    ...(row.retail_valid_targets ?? []),
    ...(row.old_slots ?? []),
    ...(row.new_slots ?? []),
    ...(row.retail_slots ?? []),
    row.choice,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => `${value}`.toLowerCase())
    .join(" ");
}

function normalizedStringList(values: string[] | null | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0))).sort();
}

function displayItemName(value: string | null | undefined, fallback = "-") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return value.trim() === "." ? "(Empty)" : value;
}

function isEmptyItemName(value: string | null | undefined) {
  return value?.trim() === ".";
}

function shouldShowJapaneseName(
  englishValue: string | null | undefined,
  japaneseValue: string | null | undefined,
) {
  if (japaneseValue === null || japaneseValue === undefined) {
    return false;
  }

  return displayItemName(englishValue, "") !== displayItemName(japaneseValue, "");
}

function validTargetPresetKey(values: string[] | null | undefined) {
  return JSON.stringify(normalizedStringList(values));
}

function slotPresetKey(values: string[] | null | undefined) {
  return JSON.stringify(normalizedStringList(values));
}

function buildRowIndexById(rows: ItemDiffUiRow[]) {
  const indexById = new Map<number, number>();
  rows.forEach((row, index) => {
    indexById.set(row.row, index);
  });
  return indexById;
}

function buildRetailChangedRowIdSet(
  rows: ItemDiffUiRow[],
  retailSnapshotByRow: Record<number, ItemDiffRetailSnapshot>,
) {
  return new Set(
    rows
      .filter((row) => isRetailChangedRow(row, retailSnapshotByRow[row.row]))
      .map((row) => row.row),
  );
}

function ItemDiffTool() {
  const {
    folders: { getDatFolder, getProjectFolder },
  } = useData();
  const [searchParams] = useSearchParams();
  const cachedState = loadCachedState();

  const [editedPath, setEditedPath] = createSignal(cachedState?.edited_path ?? "");
  const [newRetailPath, setNewRetailPath] = createSignal(cachedState?.new_retail_path ?? "");
  const [oldJapanesePath, setOldJapanesePath] = createSignal(cachedState?.old_japanese_path ?? "");
  const [newJapanesePath, setNewJapanesePath] = createSignal(cachedState?.new_japanese_path ?? "");
  const [selectedDatType, setSelectedDatType] = createSignal(cachedState?.selected_dat_type ?? "");

  const [rows, setRows] = createStore<ItemDiffUiRow[]>(cachedState?.rows ?? []);
  const [rowIndexById, setRowIndexById] = createSignal<Map<number, number>>(buildRowIndexById(cachedState?.rows ?? []));
  const [retailSnapshotByRow, setRetailSnapshotByRow] = createSignal<Record<number, ItemDiffRetailSnapshot>>(
    cachedState?.retail_snapshot_by_row ?? {},
  );
  const [changedRowIds, setChangedRowIds] = createSignal<Set<number>>(
    buildRetailChangedRowIdSet(cachedState?.rows ?? [], cachedState?.retail_snapshot_by_row ?? {}),
  );
  const [oldCount, setOldCount] = createSignal(cachedState?.old_count ?? 0);
  const [newCount, setNewCount] = createSignal(cachedState?.new_count ?? 0);
  const [changedCount, setChangedCount] = createSignal(cachedState?.changed_count ?? 0);

  const [isComparing, setComparing] = createSignal(false);
  const [isSaving, setSaving] = createSignal(false);
  const [isResolvingDat, setResolvingDat] = createSignal(false);
  const [showChangedOnly, setShowChangedOnly] = createSignal(cachedState?.show_changed_only ?? true);
  const [tableFilter, setTableFilter] = createSignal(cachedState?.table_filter ?? "");
  const deferredTableFilter = createDeferred(() => tableFilter());
  const [bulkFlagToRemove, setBulkFlagToRemove] = createSignal(ITEM_FLAG_OPTIONS[0]);
  const [bulkJobToRemove, setBulkJobToRemove] = createSignal(ITEM_JOB_OPTIONS[0]);
  const [selectedRowId, setSelectedRowId] = createSignal<number | null>(cachedState?.selected_row ?? null);
  const [prefillApplied, setPrefillApplied] = createSignal(false);
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [lastSavedYamlPath, setLastSavedYamlPath] = createSignal(cachedState?.last_saved_yaml_path ?? "");
  const [lastSavedDatPath, setLastSavedDatPath] = createSignal(cachedState?.last_saved_dat_path ?? "");
  const [lastSavedJapaneseYamlPath, setLastSavedJapaneseYamlPath] = createSignal(cachedState?.last_saved_japanese_yaml_path ?? "");
  const [lastSavedJapaneseDatPath, setLastSavedJapaneseDatPath] = createSignal(cachedState?.last_saved_japanese_dat_path ?? "");
  const [rowsVersion, setRowsVersion] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [tableViewportHeight, setTableViewportHeight] = createSignal(480);

  let tableContainerRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let persistStateTimer: number | undefined;

  const [itemDatOptions] = createResource(async () => unwrap(await commands.getItemDats()));

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
      for (const flag of row.retail_flags ?? []) {
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
      for (const job of row.retail_jobs ?? []) {
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
    const index = rowIndexById().get(rowId);
    if (index === undefined) {
      return null;
    }
    return rows[index] ?? null;
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
    setRowIndexById(new Map());
    setRetailSnapshotByRow({});
    setChangedRowIds(new Set<number>());
    setOldJapanesePath("");
    setNewJapanesePath("");
    setOldCount(0);
    setNewCount(0);
    setChangedCount(0);
    setSelectedRowId(null);
    setRowsVersion((version) => version + 1);
  };

  const setEditedFile = (path: string) => {
    setEditedPath(path);

    const inferredRetailPath = inferRetailPathFromEdited(path, getDatFolder() ?? null);
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

  const chooseItemDat = async (option: DatDescriptorInfo) => {
    setResolvingDat(true);
    try {
      const englishPath = unwrap(await commands.resolveDatDescriptorPath(option.descriptor, "English"));
      const retailPath = inferRetailPathFromEdited(englishPath, getDatFolder() ?? null) ?? englishPath;

      batch(() => {
        setSelectedDatType(option.descriptor.type);
        setEditedPath(englishPath);
        setNewRetailPath(retailPath);
        resetLoadedRows();
        setLastNotice(`Selected ${option.descriptor.type}${option.has_jp ? " (EN + JP)" : " (EN only)"}.`);
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "DAT Select Error", kind: "error" });
    } finally {
      setResolvingDat(false);
    }
  };

  createEffect(() => {
    if (prefillApplied()) {
      return;
    }

    const fromListEdited = searchParams.edited;
    const fromListNewRetail = searchParams.newRetail;

    batch(() => {
      if (typeof fromListEdited === "string") {
        setEditedFile(fromListEdited);
      }
      if (typeof fromListNewRetail === "string") {
        setNewRetailFile(fromListNewRetail);
      }
      setPrefillApplied(true);
    });
  });

  createEffect(() => {
    if (!editedPath() || newRetailPath()) {
      return;
    }

    const inferredRetailPath = inferRetailPathFromEdited(editedPath(), getDatFolder() ?? null);
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
    if (currentSelected === null || !rowIndexById().has(currentSelected)) {
      setSelectedRowId(rows[0].row);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    editedPath();
    newRetailPath();
    oldJapanesePath();
    newJapanesePath();
    selectedDatType();
    retailSnapshotByRow();
    rowsVersion();
    oldCount();
    newCount();
    changedCount();
    showChangedOnly();
    tableFilter();
    selectedRowId();
    lastNotice();
    lastSavedYamlPath();
    lastSavedDatPath();
    lastSavedJapaneseYamlPath();
    lastSavedJapaneseDatPath();

    if (persistStateTimer !== undefined) {
      window.clearTimeout(persistStateTimer);
    }

    persistStateTimer = window.setTimeout(() => {
      const stateToSave: ItemDiffCachedState = {
        edited_path: editedPath(),
        new_retail_path: newRetailPath(),
        old_japanese_path: oldJapanesePath(),
        new_japanese_path: newJapanesePath(),
        selected_dat_type: selectedDatType(),
        old_count: oldCount(),
        new_count: newCount(),
        changed_count: changedCount(),
        show_changed_only: showChangedOnly(),
        table_filter: tableFilter(),
        selected_row: selectedRowId(),
        last_notice: lastNotice(),
        last_saved_yaml_path: lastSavedYamlPath(),
        last_saved_dat_path: lastSavedDatPath(),
        last_saved_japanese_yaml_path: lastSavedJapaneseYamlPath(),
        last_saved_japanese_dat_path: lastSavedJapaneseDatPath(),
      };

      try {
        window.sessionStorage.setItem(ITEM_DIFF_STATE_KEY, JSON.stringify(stateToSave));
      } catch (error) {
        console.warn("Failed to persist item diff UI state.", error);
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

  const runCompare = async () => {
    if (!editedPath() || !newRetailPath()) {
      await showMessage("Select edited and new retail item files first.", { title: "Compare Required", kind: "warning" });
      return;
    }

    setComparing(true);
    try {
      const result = unwrap(await compareItemFiles(editedPath(), newRetailPath()));
      const nextRetailSnapshotByRow: Record<number, ItemDiffRetailSnapshot> = {};
      for (const row of result.rows) {
        nextRetailSnapshotByRow[row.row] = {
          has_retail_entry: row.has_retail_entry,
          id: row.retail_id ?? null,
          name: row.retail_en_name ?? null,
          stack_size: row.retail_stack_size ?? null,
          level: row.retail_level ?? null,
          item_type: row.retail_item_type ?? null,
          shield_size: row.retail_shield_size ?? null,
          max_charges: row.retail_max_charges ?? null,
          casting_time: row.retail_casting_time ?? null,
          use_delay: row.retail_use_delay ?? null,
          reuse_delay: row.retail_reuse_delay ?? null,
          valid_targets: row.retail_valid_targets ? normalizedStringList(row.retail_valid_targets) : null,
          slots: row.retail_slots ? normalizedStringList(row.retail_slots) : null,
          icon_bytes: row.retail_icon_bytes ?? null,
          flags: row.retail_flags ? normalizedStringList(row.retail_flags) : null,
          jobs: row.retail_jobs ? normalizedStringList(row.retail_jobs) : null,
          en_description: row.retail_en_description ?? null,
          jp_name: row.retail_jp_name ?? null,
          jp_description: row.retail_jp_description ?? null,
        };
      }
      const preparedRows = result.rows.map((row) => ({
        ...row,
        choice: defaultChoiceForRow(row),
        old_name: row.old_en_name ?? null,
        new_name: row.new_en_name ?? null,
        retail_name: row.retail_en_name ?? null,
        old_description: row.old_en_description ?? null,
        new_description: row.new_en_description ?? null,
        retail_description: row.retail_en_description ?? null,
        old_flags: normalizedStringList(row.old_flags),
        new_flags: normalizedStringList(row.new_flags ?? row.old_flags ?? row.retail_flags),
        retail_flags: normalizedStringList(row.retail_flags),
        old_jobs: normalizedStringList(row.old_jobs),
        new_jobs: normalizedStringList(row.new_jobs ?? row.old_jobs ?? row.retail_jobs),
        retail_jobs: normalizedStringList(row.retail_jobs),
        old_valid_targets: normalizedStringList(row.old_valid_targets),
        new_valid_targets: normalizedStringList(row.new_valid_targets ?? row.old_valid_targets ?? row.retail_valid_targets),
        retail_valid_targets: normalizedStringList(row.retail_valid_targets),
        old_slots: normalizedStringList(row.old_slots),
        new_slots: normalizedStringList(row.new_slots ?? row.old_slots ?? row.retail_slots),
        retail_slots: normalizedStringList(row.retail_slots),
      }));
      batch(() => {
        setRows(() => preparedRows);
        setRowIndexById(buildRowIndexById(preparedRows));
        setRetailSnapshotByRow(nextRetailSnapshotByRow);
        setChangedRowIds(buildRetailChangedRowIdSet(preparedRows, nextRetailSnapshotByRow));
        setOldCount(result.old_count);
        setNewCount(result.new_count);
        setChangedCount(result.changed_count);
        setOldJapanesePath(result.old_japanese_path ?? "");
        setNewJapanesePath(result.new_japanese_path ?? "");
        setSelectedRowId(preparedRows[0]?.row ?? null);
        setLastNotice(`Loaded ${result.changed_count} changed row(s).`);
        setRowsVersion((version) => version + 1);
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Compare Error", kind: "error" });
    } finally {
      setComparing(false);
    }
  };

  const updateRowById = (rowId: number, updater: (row: ItemDiffUiRow) => void) => {
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

    const retailSnapshot = retailSnapshotByRow()[rowId];
    const wasChanged = isRetailChangedRow(currentRow, retailSnapshot);
    const isNowChanged = isRetailChangedRow(nextRow, retailSnapshot);

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

  const selectRow = (rowId: number) => {
    setSelectedRowId(Number(rowId));
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
      row.new_en_name = value;
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

  const setOptionalU32Field = (
    rowId: number,
    value: string,
    setter: (row: ItemDiffUiRow, value: number | null) => void,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) {
      updateRowById(rowId, (row) => {
        setter(row, null);
        row.choice = "New";
      });
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const nextValue = Math.trunc(parsed);
    if (nextValue < 0) {
      return;
    }

    updateRowById(rowId, (row) => {
      setter(row, nextValue);
      row.choice = "New";
    });
  };

  const setRowNewLevel = (rowId: number, value: string) => setOptionalU32Field(rowId, value, (row, nextValue) => {
    row.new_level = nextValue;
  });

  const setRowNewShieldSize = (rowId: number, value: string) => setOptionalU32Field(rowId, value, (row, nextValue) => {
    row.new_shield_size = nextValue;
  });

  const setRowNewMaxCharges = (rowId: number, value: string) => setOptionalU32Field(rowId, value, (row, nextValue) => {
    row.new_max_charges = nextValue;
  });

  const setRowNewCastingTime = (rowId: number, value: string) => setOptionalU32Field(rowId, value, (row, nextValue) => {
    row.new_casting_time = nextValue;
  });

  const setRowNewUseDelay = (rowId: number, value: string) => setOptionalU32Field(rowId, value, (row, nextValue) => {
    row.new_use_delay = nextValue;
  });

  const setRowNewReuseDelay = (rowId: number, value: string) => setOptionalU32Field(rowId, value, (row, nextValue) => {
    row.new_reuse_delay = nextValue;
  });

  const setRowNewItemType = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_item_type = value === "None" ? null : value;
      row.choice = "New";
    });
  };

  const setRowNewValidTargets = (rowId: number, values: string[]) => {
    updateRowById(rowId, (row) => {
      row.new_valid_targets = normalizedStringList(values);
      row.choice = "New";
    });
  };

  const setRowNewSlots = (rowId: number, values: string[]) => {
    updateRowById(rowId, (row) => {
      row.new_slots = normalizedStringList(values);
      row.choice = "New";
    });
  };

  const setRowNewIconBytes = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_icon_bytes = value;
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
      row.new_en_description = value;
      row.choice = "New";
    });
  };

  const setRowNewJapaneseName = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_jp_name = value;
      row.choice = "New";
    });
  };

  const setRowNewJapaneseDescription = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_jp_description = value;
      row.choice = "New";
    });
  };

  const toggleRowNewFlag = (rowId: number, flag: string, enabled: boolean) => {
    const row = (() => {
      const index = rowIndexById().get(rowId);
      return index === undefined ? undefined : rows[index];
    })();
    const current = new Set(normalizedStringList(row?.new_flags ?? row?.old_flags));
    if (enabled) {
      current.add(flag);
    } else {
      current.delete(flag);
    }
    setRowNewFlags(rowId, Array.from(current));
  };


  const toggleRowNewJob = (rowId: number, job: string, enabled: boolean) => {
    const row = (() => {
      const index = rowIndexById().get(rowId);
      return index === undefined ? undefined : rows[index];
    })();
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

  const removeFlagFromAllItems = async () => {
    if (rows.length === 0) {
      await showMessage("Compare files first so there are rows to update.", { title: "Action Blocked", kind: "warning" });
      return;
    }

    const flag = bulkFlagToRemove().trim();
    if (!flag) {
      await showMessage("Pick a flag first.", { title: "Flag Required", kind: "warning" });
      return;
    }

    const confirmed = await showConfirm(
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
    setChangedRowIds(buildRetailChangedRowIdSet(rows, retailSnapshotByRow()));
    setRowsVersion((version) => version + 1);

    setLastNotice(`Unchecked "${flag}" on editable side for ${affectedRows} row(s). Review and save.`);
  };

  const removeJobFromAllItems = async () => {
    if (rows.length === 0) {
      await showMessage("Compare files first so there are rows to update.", { title: "Action Blocked", kind: "warning" });
      return;
    }

    const job = bulkJobToRemove().trim();
    if (!job) {
      await showMessage("Pick a job first.", { title: "Job Required", kind: "warning" });
      return;
    }

    const confirmed = await showConfirm(
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
    setChangedRowIds(buildRetailChangedRowIdSet(rows, retailSnapshotByRow()));
    setRowsVersion((version) => version + 1);

    setLastNotice(`Unchecked "${job}" on editable side for ${affectedRows} row(s). Review and save.`);
  };

  const saveMerged = async (saveTarget: ItemDiffSaveTarget) => {
    if (rows.length === 0) {
      await showMessage("Compare files first so there is something to save.", { title: "Nothing To Save", kind: "warning" });
      return;
    }

    if (!editedPath() || !newRetailPath()) {
      await showMessage("Select edited and new retail item files first.", { title: "Save Blocked", kind: "warning" });
      return;
    }

    const sourcePath = editedPath();
    const autoPaths = buildAutoSavePaths(sourcePath, getProjectFolder() ?? null);
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
      saveTarget !== "japanese" &&
      (normalizePathForCompare(outYamlPath) === normalizedRetailPath ||
        (!!outDatPath && normalizePathForCompare(outDatPath) === normalizedRetailPath));
    if (writesToRetailFile) {
      await showMessage("Refusing to save: output path resolves to the selected New Retail file.", { title: "Save Blocked", kind: "error" });
      return;
    }

    const payloadRows = rows.map((row) => ({ ...row }));

    setSaving(true);
    try {
      const result = unwrap(
        await saveItemDiff(editedPath(), newRetailPath(), payloadRows, outYamlPath, outDatPath, saveTarget),
      );
      const preferredEditedPath =
        fileExtension(editedPath()) === "dat" && result.out_dat_path
          ? result.out_dat_path
          : result.out_yaml_path;

      if (result.saved_english) {
        setLastSavedYamlPath(result.out_yaml_path);
        setLastSavedDatPath(result.out_dat_path ?? "");
      }
      if (result.saved_japanese) {
        setLastSavedJapaneseYamlPath(result.japanese_out_yaml_path ?? "");
        setLastSavedJapaneseDatPath(result.japanese_out_dat_path ?? "");
      }
      if (result.saved_english && preferredEditedPath) {
        setEditedPath(preferredEditedPath);
      }
      const saveLabel = result.saved_english && result.saved_japanese
        ? "EN + JP"
        : result.saved_english
          ? "EN"
          : "JP";
      setLastNotice(
        `Saved ${result.written_count} entries to ${saveLabel}.${result.saved_english ? ` Edited source now points to: ${preferredEditedPath}` : ""}`,
      );
      await showMessage(
        `Saved ${result.written_count} entries to ${saveLabel}.${result.saved_english ? `\nEN YAML: ${result.out_yaml_path}${result.out_dat_path ? `\nEN DAT: ${result.out_dat_path}` : ""}` : ""}${result.saved_japanese ? `${result.japanese_out_yaml_path ? `\nJP YAML: ${result.japanese_out_yaml_path}` : ""}${result.japanese_out_dat_path ? `\nJP DAT: ${result.japanese_out_dat_path}` : ""}` : ""}`,
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
        <h1 class="m-0">Item Compare</h1>
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
          <Show when={lastSavedJapaneseYamlPath()}>
            <div class="max-w-[62vw] text-right truncate">
              Last saved JP YAML: <span class="font-mono text-green-200">{lastSavedJapaneseYamlPath()}</span>
            </div>
          </Show>
          <Show when={lastSavedJapaneseDatPath()}>
            <div class="max-w-[62vw] text-right truncate">
              Last saved JP DAT: <span class="font-mono text-green-200">{lastSavedJapaneseDatPath()}</span>
            </div>
          </Show>
        </div>
      </div>
      <hr />

      <div class="mt-3 flex flex-col gap-2">
        <div class="rounded-md border border-slate-700/70 bg-slate-900/20 p-2 flex flex-col gap-2">
          <div class="rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2">
            <div class="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-300">Item DATs</div>
            <div class="mt-1 text-[12px] text-slate-400">
              Pick an item DAT set. Kraken will compare your edited item DAT against retail and load Japanese text when both exist.
            </div>
            <Show
              when={!itemDatOptions.loading}
              fallback={<div class="mt-2 text-[12px] text-slate-400">Loading item DAT list...</div>}
            >
              <div class="mt-2 flex flex-wrap gap-2">
                <For each={itemDatOptions() ?? []}>
                  {(option) => (
                    <button
                      class={compactButtonClass(selectedDatType() === option.descriptor.type)}
                      disabled={isResolvingDat() || isComparing()}
                      title={option.has_jp ? "Compares paired English and Japanese item text." : "Compares English-only item text."}
                      onClick={() => {
                        void chooseItemDat(option);
                      }}
                    >
                      {option.descriptor.type}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="min-w-0 flex flex-col gap-1 text-xs">
            <div class="flex items-center gap-2">
              <span class="uppercase tracking-[0.08em] text-slate-400">EN Source</span>
              <span class="font-mono truncate" title={editedPath() || "Not selected"}>
                {editedPath() || "Not selected"}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="uppercase tracking-[0.08em] text-slate-400">Retail Source</span>
              <span class="font-mono truncate" title={newRetailPath() || "Not selected"}>
                {newRetailPath() || "Not selected"}
              </span>
            </div>
            <Show when={oldJapanesePath()}>
              <div class="flex items-center gap-2">
                <span class="uppercase tracking-[0.08em] text-slate-400">JP Source</span>
                <span class="font-mono truncate" title={oldJapanesePath()}>
                  {oldJapanesePath()}
                </span>
              </div>
            </Show>
            <Show when={newJapanesePath()}>
              <div class="flex items-center gap-2">
                <span class="uppercase tracking-[0.08em] text-slate-400">Retail JP</span>
                <span class="font-mono truncate" title={newJapanesePath()}>
                  {newJapanesePath()}
                </span>
              </div>
            </Show>
          </div>

          <div class="text-[11px] text-slate-400">
            Retail is read-only input. Saves only write to your edited-side output.
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              class={compactButtonClass()}
              disabled={isComparing() || isResolvingDat() || !editedPath() || !newRetailPath()}
              onClick={runCompare}
            >
              {isComparing() ? "Reloading..." : "Reload"}
            </button>

            <Show when={rows.length > 0}>
              <button
                class={compactButtonClass(showChangedOnly())}
                onClick={() => setShowChangedOnly(!showChangedOnly())}
              >
                {showChangedOnly() ? "Showing changed rows" : "Showing all rows"}
              </button>
            </Show>

            <button
              class={compactButtonClass()}
              disabled={isSaving() || rows.length === 0}
              onClick={() => {
                void saveMerged("english");
              }}
            >
              {isSaving() ? "Saving..." : "Save EN"}
            </button>

            <button
              class={compactButtonClass()}
              disabled={isSaving() || rows.length === 0 || (!oldJapanesePath() && !newJapanesePath())}
              onClick={() => {
                void saveMerged("japanese");
              }}
            >
              {isSaving() ? "Saving..." : "Save JP"}
            </button>

            <button
              class={compactButtonClass()}
              disabled={isSaving() || rows.length === 0}
              onClick={() => {
                void saveMerged("both");
              }}
            >
              {isSaving() ? "Saving..." : "Save EN + JP"}
            </button>

            <Show when={rows.length > 0}>
              <input
                class="m-0 min-w-[12rem] flex-1 md:flex-none md:w-64 py-0.5 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                name="item-compare-search"
                autocomplete="off"
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
              <div class="flex flex-col items-end gap-1">
                <div class="text-slate-300">
                  Current: {oldCount()} | Retail: {newCount()} | Changed: {changedCount()}
                </div>
              </div>
            </Show>
          </div>
        </div>

        <Show when={rows.length > 0}>

          <div class="rounded-md border border-rose-700/60 bg-rose-950/15 px-3 py-2">
            <div class="text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-200">Danger Zone</div>
            <div class="text-xs text-rose-300">
              Bulk removals only affect the editable side. Nothing is written until you save.
            </div>
            <div class="mt-2 flex flex-wrap items-end gap-2">
              <div class="flex items-center gap-2">
                <span class="text-[11px] text-rose-200 whitespace-nowrap">Remove Flag</span>
                <select
                  class="m-0 min-w-[9rem] py-0 px-2 text-xs rounded-md bg-slate-800 border border-slate-500 focus:border-slate-300 focus:outline-none"
                  value={bulkFlagToRemove()}
                  onChange={(e) => setBulkFlagToRemove(e.currentTarget.value)}
                >
                  <For each={allFlagOptions()}>
                    {(flag) => <option value={flag}>{flag}</option>}
                  </For>
                </select>
                <button
                  class="my-0 px-1.5 py-0.5 text-xs font-normal rounded-md border border-rose-500 bg-rose-900 text-rose-100 hover:border-rose-300 disabled:text-slate-600 disabled:border-slate-600"
                  disabled={rows.length === 0}
                  onClick={removeFlagFromAllItems}
                >
                  Remove From All
                </button>
              </div>

              <div class="flex items-center gap-2">
                <span class="text-[11px] text-rose-200 whitespace-nowrap">Remove Job</span>
                <select
                  class="m-0 min-w-[9rem] py-0 px-2 text-xs rounded-md bg-slate-800 border border-slate-500 focus:border-slate-300 focus:outline-none"
                  value={bulkJobToRemove()}
                  onChange={(e) => setBulkJobToRemove(e.currentTarget.value)}
                >
                  <For each={allJobOptions()}>
                    {(job) => <option value={job}>{job}</option>}
                  </For>
                </select>
                <button
                  class="my-0 px-1.5 py-0.5 text-xs font-normal rounded-md border border-rose-500 bg-rose-900 text-rose-100 hover:border-rose-300 disabled:text-slate-600 disabled:border-slate-600"
                  disabled={rows.length === 0}
                  onClick={removeJobFromAllItems}
                >
                  Remove From All
                </button>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-3">
            <div
              class="max-h-[70vh] overflow-auto border border-slate-700 rounded-md"
              ref={(el) => {
                tableContainerRef = el;
              }}
              onScroll={onTableScroll}
            >
              <table class="w-full table-fixed">
                <colgroup>
                  <col class="w-[3.5rem]" />
                  <col />
                </colgroup>
                <thead class="sticky top-0 z-10">
                  <tr>
                    <th>ID</th>
                    <th>Item Name</th>
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
                        class={`${isRetailChangedRow(row, retailSnapshotByRow()[row.row]) ? "bg-slate-700/40" : ""} ${isChangedRow(row) ? "bg-rose-950/20" : ""} ${selectedRowId() === row.row ? "bg-sky-900/35" : ""} cursor-pointer`}
                        onMouseDown={() => selectRow(row.row)}
                        onClick={() => selectRow(row.row)}
                      >
                        <td class="font-mono whitespace-nowrap tabular-nums overflow-visible">{row.new_id ?? row.old_id ?? "-"}</td>
                        <td class="truncate" title={displayItemName(row.new_en_name ?? row.old_en_name ?? row.new_jp_name ?? row.old_jp_name)}>
                          <span class={isEmptyItemName(row.new_en_name ?? row.old_en_name) ? "text-slate-400 italic" : ""}>
                            {displayItemName(row.new_en_name ?? row.old_en_name ?? row.new_jp_name ?? row.old_jp_name)}
                          </span>
                          <Show when={row.has_japanese && shouldShowJapaneseName(row.new_en_name ?? row.old_en_name, row.new_jp_name ?? row.old_jp_name)}>
                            <span class="ml-2 text-[11px] text-slate-400">
                              {displayItemName(row.new_jp_name ?? row.old_jp_name, "-")}
                            </span>
                          </Show>
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
                  const hasRetailEntry = () => retailSnapshot()?.has_retail_entry ?? row.has_retail_entry;
                  const retailId = () => retailSnapshot()?.id ?? row.retail_id;
                  const retailName = () => retailSnapshot()?.name ?? row.retail_en_name;
                  const retailStackSize = () => retailSnapshot()?.stack_size ?? row.retail_stack_size;
                  const currentFlags = () => normalizedStringList(row.old_flags ?? row.new_flags);
                  const targetFlags = () => normalizedStringList(row.new_flags ?? row.old_flags);
                  const retailFlags = () => normalizedStringList(retailSnapshot()?.flags ?? []);
                  const currentJobs = () => normalizedStringList(row.old_jobs ?? row.new_jobs);
                  const targetJobs = () => normalizedStringList(row.new_jobs ?? row.old_jobs);
                  const retailJobs = () => normalizedStringList(retailSnapshot()?.jobs ?? []);
                  const currentDescription = () => row.new_en_description ?? row.old_en_description ?? "";
                  const retailDescription = () => retailSnapshot()?.en_description ?? row.retail_en_description ?? "";
                  const retailLevel = () => retailSnapshot()?.level ?? row.retail_level;
                  const retailItemType = () => retailSnapshot()?.item_type ?? row.retail_item_type;
                  const retailShieldSize = () => retailSnapshot()?.shield_size ?? row.retail_shield_size;
                  const retailMaxCharges = () => retailSnapshot()?.max_charges ?? row.retail_max_charges;
                  const retailCastingTime = () => retailSnapshot()?.casting_time ?? row.retail_casting_time;
                  const retailUseDelay = () => retailSnapshot()?.use_delay ?? row.retail_use_delay;
                  const retailReuseDelay = () => retailSnapshot()?.reuse_delay ?? row.retail_reuse_delay;
                  const retailValidTargets = () => normalizedStringList(retailSnapshot()?.valid_targets ?? row.retail_valid_targets);
                  const retailSlots = () => normalizedStringList(retailSnapshot()?.slots ?? row.retail_slots);
                  const retailIconBytes = () => retailSnapshot()?.icon_bytes ?? row.retail_icon_bytes ?? "";
                  const retailJpName = () => retailSnapshot()?.jp_name ?? row.retail_jp_name ?? "";
                  const retailJpDescription = () => retailSnapshot()?.jp_description ?? row.retail_jp_description ?? "";
                  const editedIconUrl = () => row.old_id !== null
                    ? `https://static.ffxiah.com/images/icon/${row.old_id}.png`
                    : null;
                  const idDiffersFromRetail = () => row.old_id !== retailId();
                  const nameDiffersFromRetail = () => row.old_en_name !== retailName();
                  const stackDiffersFromRetail = () => row.old_stack_size !== retailStackSize();
                  const levelDiffersFromRetail = () => row.old_level !== retailLevel();
                  const itemTypeDiffersFromRetail = () => (row.old_item_type ?? null) !== (retailItemType() ?? null);
                  const shieldSizeDiffersFromRetail = () => row.old_shield_size !== retailShieldSize();
                  const maxChargesDiffersFromRetail = () => row.old_max_charges !== retailMaxCharges();
                  const castingTimeDiffersFromRetail = () => row.old_casting_time !== retailCastingTime();
                  const useDelayDiffersFromRetail = () => row.old_use_delay !== retailUseDelay();
                  const reuseDelayDiffersFromRetail = () => row.old_reuse_delay !== retailReuseDelay();
                  const validTargetsDifferFromRetail = () => !arraysEqual(normalizedStringList(row.old_valid_targets), retailValidTargets());
                  const slotsDifferFromRetail = () => !arraysEqual(normalizedStringList(row.old_slots), retailSlots());
                  const iconBytesDifferFromRetail = () => (row.old_icon_bytes ?? "") !== retailIconBytes();
                  const flagsDifferFromRetail = () => !arraysEqual(currentFlags(), retailFlags());
                  const jobsDifferFromRetail = () => !arraysEqual(currentJobs(), retailJobs());
                  const descriptionDiffersFromRetail = () => currentDescription() !== retailDescription();
                  const jpNameDiffersFromRetail = () => (row.old_jp_name ?? "") !== retailJpName();
                  const jpDescriptionDiffersFromRetail = () => (row.old_jp_description ?? "") !== retailJpDescription();
                  const flagOptions = Array.from(new Set([...ITEM_FLAG_OPTIONS, ...(row.old_flags ?? []), ...(row.new_flags ?? [])])).sort();
                  const jobOptions = ITEM_JOB_OPTIONS;
                  const itemTypeOptions = Array.from(new Set([
                    ...ITEM_TYPE_OPTIONS,
                    ...(row.old_item_type ? [row.old_item_type] : []),
                    ...(row.new_item_type ? [row.new_item_type] : []),
                    ...(row.retail_item_type ? [row.retail_item_type] : []),
                  ])).sort();
                  const validTargetPresetOptions = Array.from(new Map([
                    ...VALID_TARGET_PRESETS,
                    { label: "Current", values: normalizedStringList(row.old_valid_targets) },
                    { label: "Retail", values: retailValidTargets() },
                    { label: "Edited", values: normalizedStringList(row.new_valid_targets) },
                  ].map((preset) => [validTargetPresetKey(preset.values), preset])).values());
                  const slotPresetOptions = Array.from(new Map([
                    ...SLOT_PRESETS,
                    { label: "Current", values: normalizedStringList(row.old_slots) },
                    { label: "Retail", values: retailSlots() },
                    { label: "Edited", values: normalizedStringList(row.new_slots) },
                  ].map((preset) => [slotPresetKey(preset.values), preset])).values());
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
                        <div class="text-sm font-semibold">Row {row.row}: {row.new_en_name ?? row.old_en_name ?? "Unknown item"}</div>
                      </div>

                      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm items-start">
                        <div class="border border-slate-700 rounded-md p-2">
                          <div class="mb-2 font-semibold text-slate-200">Edit</div>
                          <div class="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-2">
                            <div class="grid grid-cols-[minmax(5.75rem,auto)_minmax(0,1fr)] gap-y-2 gap-x-2 content-start xl:col-span-2">
                              <div class="text-slate-300">EN Name:</div>
                              <input
                                class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_en_name !== row.new_en_name)}`}
                                type="text"
                                name={`item-diff-en-name-${rowId}`}
                                autocomplete="off"
                                value={row.new_en_name ?? ""}
                                title={displayItemName(row.new_en_name ?? row.old_en_name)}
                                onInput={(e) => setRowNewName(rowId, e.currentTarget.value)}
                              />

                              <Show when={row.has_japanese}>
                                <>
                                  <div class="text-slate-300">JP Name:</div>
                                  <input
                                    class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_jp_name ?? null) !== (row.new_jp_name ?? null))}`}
                                    type="text"
                                    name={`item-diff-jp-name-${rowId}`}
                                    autocomplete="off"
                                    value={row.new_jp_name ?? ""}
                                    title={displayItemName(row.new_jp_name ?? row.old_jp_name)}
                                    onInput={(e) => setRowNewJapaneseName(rowId, e.currentTarget.value)}
                                  />
                                </>
                              </Show>
                            </div>

                            <div class="grid grid-cols-[minmax(5.75rem,auto)_minmax(0,1fr)] gap-y-2 gap-x-2 content-start">
                            <div class="text-slate-300">ID:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_id !== row.new_id)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_id ?? ""}
                              onInput={(e) => setRowNewId(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Stack:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_stack_size !== row.new_stack_size)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_stack_size ?? ""}
                              onInput={(e) => setRowNewStackSize(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Item Type:</div>
                            <select
                              class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_item_type ?? null) !== (row.new_item_type ?? null))}`}
                              value={row.new_item_type ?? "None"}
                              onChange={(e) => setRowNewItemType(rowId, e.currentTarget.value)}
                            >
                              <For each={itemTypeOptions}>
                                {(itemType) => <option value={itemType}>{itemType}</option>}
                              </For>
                            </select>

                            <div class="text-slate-300">Valid Targets:</div>
                            <select
                              class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass(!arraysEqual(row.old_valid_targets, row.new_valid_targets))}`}
                              value={validTargetPresetKey(row.new_valid_targets ?? row.old_valid_targets)}
                              onChange={(e) => {
                                const selectedPreset = validTargetPresetOptions.find((preset) => validTargetPresetKey(preset.values) === e.currentTarget.value);
                                setRowNewValidTargets(rowId, selectedPreset?.values ?? []);
                              }}
                            >
                              <For each={validTargetPresetOptions}>
                                {(preset) => <option value={validTargetPresetKey(preset.values)}>{preset.label}</option>}
                              </For>
                            </select>

                            <div class="text-slate-300">Slots:</div>
                            <select
                              class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass(!arraysEqual(row.old_slots, row.new_slots))}`}
                              value={slotPresetKey(row.new_slots ?? row.old_slots)}
                              onChange={(e) => {
                                const selectedPreset = slotPresetOptions.find((preset) => slotPresetKey(preset.values) === e.currentTarget.value);
                                setRowNewSlots(rowId, selectedPreset?.values ?? []);
                              }}
                            >
                              <For each={slotPresetOptions}>
                                {(preset) => <option value={slotPresetKey(preset.values)}>{preset.label}</option>}
                              </For>
                            </select>
                            </div>

                            <div class="grid grid-cols-[minmax(5.75rem,auto)_minmax(0,1fr)] gap-y-2 gap-x-2 content-start">
                            <div class="text-slate-300">Level:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_level !== row.new_level)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_level ?? ""}
                              onInput={(e) => setRowNewLevel(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Shield Size:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_shield_size !== row.new_shield_size)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_shield_size ?? ""}
                              onInput={(e) => setRowNewShieldSize(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Max Charges:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_max_charges !== row.new_max_charges)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_max_charges ?? ""}
                              onInput={(e) => setRowNewMaxCharges(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Casting Time:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_casting_time !== row.new_casting_time)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_casting_time ?? ""}
                              onInput={(e) => setRowNewCastingTime(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Use Delay:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_use_delay !== row.new_use_delay)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_use_delay ?? ""}
                              onInput={(e) => setRowNewUseDelay(rowId, e.currentTarget.value)}
                            />

                            <div class="text-slate-300">Reuse Delay:</div>
                            <input
                              class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_reuse_delay !== row.new_reuse_delay)}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.new_reuse_delay ?? ""}
                              onInput={(e) => setRowNewReuseDelay(rowId, e.currentTarget.value)}
                            />
                          </div>
                        </div>
                        </div>
                        <div class={retailDiffPanelClass(idDiffersFromRetail() || nameDiffersFromRetail() || stackDiffersFromRetail())}>
                          <div class="mb-2 font-semibold text-slate-200">Current</div>
                          <div class="flex items-start gap-3">
                            <Show when={editedIconUrl()}>
                              <img
                                src={editedIconUrl()!}
                                alt=""
                                class="h-16 w-16 shrink-0 rounded-sm border border-slate-700 bg-slate-900 object-contain"
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
                              <div class={retailDiffValueClass(nameDiffersFromRetail())}>{row.old_en_name ?? "-"}</div>

                              <div class="text-slate-300">Stack:</div>
                              <div class={`font-mono ${retailDiffValueClass(stackDiffersFromRetail())}`}>{row.old_stack_size ?? "-"}</div>
                            </div>
                          </div>
                        </div>

                      </div>

                      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm items-start">
                        <div class={retailDiffPanelClass(
                          levelDiffersFromRetail() ||
                          itemTypeDiffersFromRetail() ||
                          validTargetsDifferFromRetail() ||
                          slotsDifferFromRetail() ||
                          shieldSizeDiffersFromRetail() ||
                          maxChargesDiffersFromRetail() ||
                          castingTimeDiffersFromRetail() ||
                          useDelayDiffersFromRetail() ||
                          reuseDelayDiffersFromRetail()
                        )}>
                          <div class="mb-2 font-semibold text-slate-200">Current Fields</div>
                          <div class="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1 gap-x-2">
                            <div class="text-slate-300">Item Type:</div>
                            <div class={retailDiffValueClass(itemTypeDiffersFromRetail())}>{row.old_item_type ?? "-"}</div>
                            <div class="text-slate-300">Valid Targets:</div>
                            <div class={retailDiffValueClass(validTargetsDifferFromRetail())}>{normalizedStringList(row.old_valid_targets).join(", ") || "-"}</div>
                            <div class="text-slate-300">Slots:</div>
                            <div class={retailDiffValueClass(slotsDifferFromRetail())}>{normalizedStringList(row.old_slots).join(", ") || "-"}</div>
                            <div class="text-slate-300">Level:</div>
                            <div class={`font-mono ${retailDiffValueClass(levelDiffersFromRetail())}`}>{row.old_level ?? "-"}</div>
                            <div class="text-slate-300">Shield Size:</div>
                            <div class={`font-mono ${retailDiffValueClass(shieldSizeDiffersFromRetail())}`}>{row.old_shield_size ?? "-"}</div>
                            <div class="text-slate-300">Max Charges:</div>
                            <div class={`font-mono ${retailDiffValueClass(maxChargesDiffersFromRetail())}`}>{row.old_max_charges ?? "-"}</div>
                            <div class="text-slate-300">Casting Time:</div>
                            <div class={`font-mono ${retailDiffValueClass(castingTimeDiffersFromRetail())}`}>{row.old_casting_time ?? "-"}</div>
                            <div class="text-slate-300">Use Delay:</div>
                            <div class={`font-mono ${retailDiffValueClass(useDelayDiffersFromRetail())}`}>{row.old_use_delay ?? "-"}</div>
                            <div class="text-slate-300">Reuse Delay:</div>
                            <div class={`font-mono ${retailDiffValueClass(reuseDelayDiffersFromRetail())}`}>{row.old_reuse_delay ?? "-"}</div>
                          </div>
                        </div>

                        <div class={retailDiffPanelClass(
                          levelDiffersFromRetail() ||
                          itemTypeDiffersFromRetail() ||
                          validTargetsDifferFromRetail() ||
                          slotsDifferFromRetail() ||
                          shieldSizeDiffersFromRetail() ||
                          maxChargesDiffersFromRetail() ||
                          castingTimeDiffersFromRetail() ||
                          useDelayDiffersFromRetail() ||
                          reuseDelayDiffersFromRetail()
                        )}>
                          <div class="mb-2 font-semibold text-slate-200">Retail Fields</div>
                          <Show
                            when={hasRetailEntry()}
                            fallback={<div class="text-sm text-slate-400">Retail row missing for this item.</div>}
                          >
                            <div class="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1 gap-x-2">
                              <div class="text-slate-300">Item Type:</div>
                              <div class={retailDiffValueClass(itemTypeDiffersFromRetail())}>{retailItemType() ?? "-"}</div>
                              <div class="text-slate-300">Valid Targets:</div>
                              <div class={retailDiffValueClass(validTargetsDifferFromRetail())}>{retailValidTargets().join(", ") || "-"}</div>
                              <div class="text-slate-300">Slots:</div>
                              <div class={retailDiffValueClass(slotsDifferFromRetail())}>{retailSlots().join(", ") || "-"}</div>
                              <div class="text-slate-300">Level:</div>
                              <div class={`font-mono ${retailDiffValueClass(levelDiffersFromRetail())}`}>{retailLevel() ?? "-"}</div>
                              <div class="text-slate-300">Shield Size:</div>
                              <div class={`font-mono ${retailDiffValueClass(shieldSizeDiffersFromRetail())}`}>{retailShieldSize() ?? "-"}</div>
                              <div class="text-slate-300">Max Charges:</div>
                              <div class={`font-mono ${retailDiffValueClass(maxChargesDiffersFromRetail())}`}>{retailMaxCharges() ?? "-"}</div>
                              <div class="text-slate-300">Casting Time:</div>
                              <div class={`font-mono ${retailDiffValueClass(castingTimeDiffersFromRetail())}`}>{retailCastingTime() ?? "-"}</div>
                              <div class="text-slate-300">Use Delay:</div>
                              <div class={`font-mono ${retailDiffValueClass(useDelayDiffersFromRetail())}`}>{retailUseDelay() ?? "-"}</div>
                              <div class="text-slate-300">Reuse Delay:</div>
                              <div class={`font-mono ${retailDiffValueClass(reuseDelayDiffersFromRetail())}`}>{retailReuseDelay() ?? "-"}</div>
                            </div>
                          </Show>
                        </div>

                        <div class={retailDiffPanelClass(iconBytesDifferFromRetail()) + " lg:col-span-2"}>
                          <div class="mb-2 text-sm font-semibold text-slate-200">Icon Bytes</div>
                          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div>
                              <div class="mb-1 text-xs font-semibold text-slate-300">Edit</div>
                              <textarea
                                class={`m-0 min-h-48 w-full resize-y rounded-md border bg-slate-800 px-2 py-1 font-mono text-[11px] leading-4 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_icon_bytes ?? null) !== (row.new_icon_bytes ?? null))}`}
                                spellcheck={false}
                                value={row.new_icon_bytes ?? ""}
                                onInput={(e) => setRowNewIconBytes(rowId, e.currentTarget.value)}
                              />
                            </div>
                            <div>
                              <div class="mb-1 text-xs font-semibold text-slate-300">Retail</div>
                              <Show
                                when={hasRetailEntry()}
                                fallback={<div class="text-sm text-slate-400">Retail row missing for this item.</div>}
                              >
                                <textarea
                                  class={`m-0 min-h-48 w-full resize-y rounded-md border bg-slate-900 px-2 py-1 font-mono text-[11px] leading-4 text-slate-100 focus:outline-none ${iconBytesDifferFromRetail() ? "border-amber-500/70" : "border-slate-700"}`}
                                  readonly
                                  spellcheck={false}
                                  value={retailIconBytes()}
                                />
                              </Show>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="border-t border-slate-700 pt-2">
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                          <div class="text-sm font-semibold">Flags</div>
                          <div class="text-sm font-semibold">Jobs</div>

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

                          <Show
                            when={hasEquipmentJobs}
                            fallback={<div class="text-sm text-slate-400">No equipment jobs field on this item.</div>}
                          >
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
                          </Show>

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

                          <Show
                            when={hasEquipmentJobs}
                            fallback={<div class="hidden lg:block" aria-hidden="true"></div>}
                          >
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
                          </Show>

                          <div class="border border-slate-700 rounded-md p-2">
                            <div class="mb-2 text-sm font-semibold text-slate-200">Add / Remove (editable)</div>
                            <div class="mb-2 text-xs text-slate-300">
                              <span class="text-emerald-300">+{addedFlags().length}</span>
                              {" "}added
                              {"  "}
                              <span class="text-rose-300">-{removedFlags().length}</span>
                              {" "}removed
                            </div>
                            <div class="border border-slate-700 rounded-md p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-2">
                              <For each={filteredFlagOptions}>
                                {(flag) => (
                                  <label class="grid min-w-0 grid-cols-[1rem,minmax(0,1fr)] items-start gap-x-2 text-xs leading-5">
                                    <input
                                      type="checkbox"
                                      class="mt-1"
                                      checked={targetFlags().includes(flag)}
                                      onChange={(e) => toggleRowNewFlag(rowId, flag, e.currentTarget.checked)}
                                    />
                                    <span class={`min-w-0 break-words ${listChangeTextClass(currentFlags(), targetFlags(), flag)}`} title={flag}>{flag}</span>
                                  </label>
                                )}
                              </For>
                            </div>
                          </div>

                          <Show
                            when={hasEquipmentJobs}
                            fallback={<div class="hidden lg:block" aria-hidden="true"></div>}
                          >
                            <div class="border border-slate-700 rounded-md p-2">
                              <div class="mb-2 text-sm font-semibold text-slate-200">Add / Remove (editable)</div>
                              <div class="mb-2 text-xs text-slate-300">
                                <span class="text-emerald-300">+{addedJobs().length}</span>
                                {" "}added
                                {"  "}
                                <span class="text-rose-300">-{removedJobs().length}</span>
                                {" "}removed
                              </div>
                              <div class="border border-slate-700 rounded-md p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-2">
                                <For each={filteredJobOptions}>
                                  {(job) => (
                                    <label class="grid min-w-0 grid-cols-[1rem,minmax(0,1fr)] items-start gap-x-2 text-xs leading-5">
                                      <input
                                        type="checkbox"
                                        class="mt-1"
                                        checked={targetJobs().includes(job)}
                                        onChange={(e) => toggleRowNewJob(rowId, job, e.currentTarget.checked)}
                                      />
                                      <span class={`min-w-0 break-words ${listChangeTextClass(currentJobs(), targetJobs(), job)}`} title={job}>{job}</span>
                                    </label>
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </div>

                      <div class="border-t border-slate-700 pt-2">
                        <div class="flex flex-col gap-3">
                          <div class="text-sm font-semibold">Description</div>
                          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                            <div class={retailDiffPanelClass(descriptionDiffersFromRetail())}>
                              <div class="mb-2 text-sm font-semibold text-slate-200">English Current (editable)</div>
                              <textarea
                                class={`m-0 min-h-40 w-full resize-y px-2 py-1 text-sm rounded-md border bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${descriptionDiffersFromRetail() ? "border-amber-500/70" : "border-slate-500"}`}
                                rows={5}
                                value={currentDescription()}
                                onInput={(e) => setRowNewDescription(rowId, e.currentTarget.value)}
                              />
                            </div>

                            <div class={retailDiffPanelClass(descriptionDiffersFromRetail())}>
                              <div class="mb-2 text-sm font-semibold text-slate-200">English Retail (read-only)</div>
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

                          <Show when={row.has_japanese}>
                            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                              <div class={retailDiffPanelClass(jpNameDiffersFromRetail() || jpDescriptionDiffersFromRetail())}>
                                <div class="mb-2 text-sm font-semibold text-slate-200">Japanese Current (editable)</div>
                                <textarea
                                  class={`m-0 min-h-36 w-full resize-y px-2 py-1 text-sm rounded-md border bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${jpDescriptionDiffersFromRetail() ? "border-amber-500/70" : "border-slate-500"}`}
                                  rows={5}
                                  value={row.new_jp_description ?? row.old_jp_description ?? ""}
                                  onInput={(e) => setRowNewJapaneseDescription(rowId, e.currentTarget.value)}
                                />
                              </div>

                              <div class={retailDiffPanelClass(jpDescriptionDiffersFromRetail())}>
                                <div class="mb-2 text-sm font-semibold text-slate-200">Japanese Retail (read-only)</div>
                                <Show
                                  when={hasRetailEntry()}
                                  fallback={<div class="text-sm text-slate-400">Retail row missing for this item.</div>}
                                >
                                  <textarea
                                    class="m-0 min-h-36 w-full resize-y px-2 py-1 text-sm rounded-md border border-slate-700 bg-slate-900 text-slate-100 focus:outline-none"
                                    rows={5}
                                    readonly
                                    value={retailJpDescription()}
                                  />
                                </Show>
                              </div>
                            </div>
                          </Show>
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
