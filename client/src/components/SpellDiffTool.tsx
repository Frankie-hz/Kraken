import { open } from "@tauri-apps/plugin-dialog";
import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createEffect, createMemo, createResource, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { SpellDiffRow, compareSpellFiles, copySpellDatToProject, isSpellDatMadeInProject, resetSpellDatToRetailBase, saveSpellDiff } from "../custom_bindings";
import { showConfirm, showMessage } from "../dialogs";
import { useData } from "../store";
import { projectDisplayPath, unwrap } from "../util";

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

  return `${projectRoot.replaceAll("\\", "/").replace(/\/+$/, "")}/Custom`;
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function pathIsWithinRoot(path: string, root: string | null) {
  if (!path || !root) {
    return false;
  }

  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
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

function estimateWrappedLines(text: string | null | undefined, charsPerLine: number) {
  const safeCharsPerLine = Math.max(1, charsPerLine);
  const lines = (text ?? "").split(/\r?\n/);
  if (lines.length === 0) {
    return 1;
  }

  return lines.reduce((total, line) => {
    const length = Array.from(line || " ").length;
    return total + Math.max(1, Math.ceil(length / safeCharsPerLine));
  }, 0);
}

const VALID_TARGET_OPTIONS = [
  "SelfTarget",
  "Player",
  "PartyMember",
  "Ally",
  "NPC",
  "Enemy",
  "Object",
  "Corpse",
  "CorpseOnly",
];

const VALID_TARGET_LABELS: Record<string, string> = {
  SelfTarget: "Self",
  PartyMember: "Party",
};

const AOE_TYPE_OPTIONS = ["None", "TargetAoe", "SelfConal", "SelfAoe"];
const VALID_TARGET_TYPE_OPTIONS = [
  "All",
  "SelfTarget",
  "SelfAoe",
  "SelfAoe2",
  "MobSelfAoe",
  "Party",
  "PartyAoe",
  "Luopan",
  "Pet",
  "Pc",
  "SelfPet",
  "Mob",
  "MobAoe",
  "Dead",
];

const COMPACT_VALUE_INPUT_CLASS = "hide-spin-buttons m-0 min-w-0 w-full py-0 px-1 text-xs font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none";
const COMPACT_VALUE_SELECT_CLASS = "m-0 min-w-0 w-full py-0 px-1 text-xs rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none";
const COMPACT_VALUE_FIELD_CLASS = "m-0 grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-0.5 text-[11px] font-normal uppercase tracking-wide text-slate-300";

function normalizeStringList(values: string[] | null | undefined) {
  const normalized = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function stringListsEqual(left: string[] | null | undefined, right: string[] | null | undefined) {
  const normalizedLeft = normalizeStringList(left);
  const normalizedRight = normalizeStringList(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function validTargetOptionsForValues(...lists: Array<string[] | null | undefined>) {
  const merged = new Set(VALID_TARGET_OPTIONS);
  for (const list of lists) {
    for (const value of normalizeStringList(list)) {
      merged.add(value);
    }
  }

  return Array.from(merged);
}

function validTargetLabel(target: string) {
  return VALID_TARGET_LABELS[target] ?? target;
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
  const nameJp = row.new_name_jp ?? row.old_name_jp ?? "";
  const descriptionEn = row.new_description_en ?? row.old_description_en ?? "";
  const descriptionJp = row.new_description_jp ?? row.old_description_jp ?? "";
  const levels = formatLevels(row.new_level_required ?? row.old_level_required ?? null);
  const validTargets = normalizeStringList(row.new_valid_targets ?? row.old_valid_targets).join(" ");

  const haystack = [
    name,
    nameJp,
    row.new_index ?? row.old_index,
    row.new_mp_cost ?? row.old_mp_cost,
    row.new_cast_time ?? row.old_cast_time,
    row.new_recast_time ?? row.old_recast_time,
    row.new_range ?? row.old_range,
    row.new_radius ?? row.old_radius,
    row.new_aoe_type ?? row.old_aoe_type,
    row.new_valid_target_type ?? row.old_valid_target_type,
    descriptionEn,
    descriptionJp,
    validTargets,
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

function spellLevelsEqual(
  left: Record<string, number> | null | undefined,
  right: Record<string, number> | null | undefined,
) {
  return formatLevels(left ?? null) === formatLevels(right ?? null);
}

const compactButtonBaseClass = "my-0 px-1.5 py-0.5 text-xs font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
const compactButtonActiveClass = "bg-green-800 border-green-500 text-slate-100";

const SPELL_RELATIVE_PATH = "ROM/118/114.DAT";
const SPELL_EDITOR_STATE_KEY = "xi_tinkerer_spell_editor_state_v1";

const MIN_VIRTUAL_ROW_HEIGHT_PX = 64;
const VIRTUAL_OVERSCAN_ROWS = 12;
const TEXTAREA_MIN_HEIGHT_PX = 52;
const TEXTAREA_LINE_HEIGHT_PX = 20;
const TEXTAREA_VERTICAL_CHROME_PX = 12;
const TEXTAREA_WRAP_SAFETY_PX = 10;
const TEXTAREA_ROW_PADDING_PX = 12;
const VALID_TARGET_ROW_HEIGHT_PX = 18;
const LEVEL_EXTRA_HEIGHT_PX = 18;
const EDITABLE_VALUES_MIN_HEIGHT_PX = 96;

// Weighted realtive to each other
const INDEX_COLUMN_WEIGHT = 5;
const NAMES_COLUMN_WEIGHT = 13;
const EDITABLE_VALUES_COLUMN_WEIGHT = 22;
const VALID_TARGETS_COLUMN_WEIGHT = 20;
const DESCRIPTION_COLUMN_WEIGHT = 18.5;
const LEVEL_COLUMN_WEIGHT = 14;

const DEFAULT_ROW_METRICS = {
  descriptionEnHeight: TEXTAREA_MIN_HEIGHT_PX,
  descriptionJpHeight: TEXTAREA_MIN_HEIGHT_PX,
  validTargetsHeight: TEXTAREA_MIN_HEIGHT_PX,
  levelHeight: TEXTAREA_MIN_HEIGHT_PX,
  rowHeight: MIN_VIRTUAL_ROW_HEIGHT_PX,
};

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
  return `${normalizedRoot}/Retail Base/${SPELL_RELATIVE_PATH}`;
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
    folders: { getProjectFolder },
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
  const [isMakingBaseDat, setMakingBaseDat] = createSignal(false);
  const [isResettingToRetailBase, setResettingToRetailBase] = createSignal(false);
  const [prefillApplied, setPrefillApplied] = createSignal(false);
  const [rowsVersion, setRowsVersion] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [tableViewportHeight, setTableViewportHeight] = createSignal(480);
  const [tableViewportWidth, setTableViewportWidth] = createSignal(960);
  const [showNamesColumn, setShowNamesColumn] = createSignal(true);
  const [showTimingColumns, setShowTimingColumns] = createSignal(true);
  const [showValidTargetsColumn, setShowValidTargetsColumn] = createSignal(true);
  const [showDescriptionsColumn, setShowDescriptionsColumn] = createSignal(true);
  const [showLevelColumn, setShowLevelColumn] = createSignal(true);

  const [levelDrafts, setLevelDrafts] = createStore<Record<number, string>>({});

  let tableContainerRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let tableMeasureFrame = 0;
  let persistStateTimer: number | undefined;
  const descriptionDrafts = new Map<number, Partial<Pick<SpellDiffRow, "new_description_en" | "new_description_jp">>>();

  const [spellBaseDatMade, { refetch: refetchSpellBaseDatMade }] = createResource(
    () => getProjectFolder(),
    async (projectFolder) => {
      if (!projectFolder) {
        return false;
      }
      return unwrap(await isSpellDatMadeInProject());
    },
  );

  const displayedRows = createMemo(() => {
    const filterText = tableFilter().trim().toLowerCase();
    if (!filterText) {
      return rows;
    }
    return rows.filter((row) => rowMatchesFilter(row, filterText));
  });

  const spellEditorColumnCount = createMemo(() =>
    1 +
    (showNamesColumn() ? 1 : 0) +
    (showTimingColumns() ? 1 : 0) +
    (showValidTargetsColumn() ? 1 : 0) +
    (showDescriptionsColumn() ? 2 : 0) +
    (showLevelColumn() ? 1 : 0)
  );

  const virtualLayout = createMemo(() => {
    rowsVersion();
    tableFilter();
    const descriptionsVisible = showDescriptionsColumn();
    const levelVisible = showLevelColumn();
    const validTargetsVisible = showValidTargetsColumn();
    const currentRows = untrack(() => displayedRows().slice());
    const tableWidth = Math.max(640, tableViewportWidth());
    const activeColumnWeight =
      INDEX_COLUMN_WEIGHT +
      (showNamesColumn() ? NAMES_COLUMN_WEIGHT : 0) +
      (showTimingColumns() ? EDITABLE_VALUES_COLUMN_WEIGHT : 0) +
      (validTargetsVisible ? VALID_TARGETS_COLUMN_WEIGHT : 0) +
      (descriptionsVisible ? DESCRIPTION_COLUMN_WEIGHT * 2 : 0) +
      (levelVisible ? LEVEL_COLUMN_WEIGHT : 0);
    const widthForWeight = (weight: number, minimumWidth: number) =>
      Math.max(minimumWidth, tableWidth * (weight / activeColumnWeight) - 24);
    const descriptionColumnWidth = widthForWeight(DESCRIPTION_COLUMN_WEIGHT, 120);
    const levelColumnWidth = widthForWeight(LEVEL_COLUMN_WEIGHT, 84);
    const enCharsPerLine = Math.max(12, Math.floor(descriptionColumnWidth / 7.2));
    const jpCharsPerLine = Math.max(8, Math.floor(descriptionColumnWidth / 13));
    const levelCharsPerLine = Math.max(8, Math.floor(levelColumnWidth / 8.8));

    const offsets = [0];
    const metricsByRow = new Map<number, typeof DEFAULT_ROW_METRICS>();

    for (const row of currentRows) {
      const descriptionEnLines = descriptionsVisible
        ? estimateWrappedLines(row.new_description_en ?? row.old_description_en, enCharsPerLine)
        : 1;
      const descriptionJpLines = descriptionsVisible
        ? estimateWrappedLines(row.new_description_jp ?? row.old_description_jp, jpCharsPerLine)
        : 1;
      const levelLines = levelVisible
        ? estimateWrappedLines(formatLevels(row.new_level_required ?? row.old_level_required ?? null), levelCharsPerLine)
        : 1;
      const targetLines = validTargetsVisible
        ? Math.ceil(validTargetOptionsForValues(row.old_valid_targets, row.new_valid_targets).length / 3)
        : 1;

      const descriptionEnHeight = Math.max(TEXTAREA_MIN_HEIGHT_PX, descriptionEnLines * TEXTAREA_LINE_HEIGHT_PX + TEXTAREA_VERTICAL_CHROME_PX + TEXTAREA_WRAP_SAFETY_PX);
      const descriptionJpHeight = Math.max(TEXTAREA_MIN_HEIGHT_PX, descriptionJpLines * TEXTAREA_LINE_HEIGHT_PX + TEXTAREA_VERTICAL_CHROME_PX + TEXTAREA_WRAP_SAFETY_PX);
      const levelHeight = Math.max(TEXTAREA_MIN_HEIGHT_PX, levelLines * TEXTAREA_LINE_HEIGHT_PX + TEXTAREA_VERTICAL_CHROME_PX + TEXTAREA_WRAP_SAFETY_PX + LEVEL_EXTRA_HEIGHT_PX);
      const validTargetsHeight = Math.max(TEXTAREA_MIN_HEIGHT_PX, targetLines * VALID_TARGET_ROW_HEIGHT_PX + TEXTAREA_VERTICAL_CHROME_PX);
      const editableValuesHeight = showTimingColumns() ? EDITABLE_VALUES_MIN_HEIGHT_PX : TEXTAREA_MIN_HEIGHT_PX;
      const controlHeight = Math.max(
        MIN_VIRTUAL_ROW_HEIGHT_PX,
        editableValuesHeight,
        descriptionEnHeight,
        descriptionJpHeight,
        validTargetsHeight,
        levelHeight,
      );
      const rowHeight = controlHeight + TEXTAREA_ROW_PADDING_PX;

      metricsByRow.set(row.row, {
        descriptionEnHeight: controlHeight,
        descriptionJpHeight: controlHeight,
        validTargetsHeight: controlHeight,
        levelHeight: controlHeight,
        rowHeight,
      });
      offsets.push(offsets[offsets.length - 1] + rowHeight);
    }

    return { offsets, metricsByRow, totalHeight: offsets[offsets.length - 1] ?? 0 };
  });

  const indexForOffset = (offset: number) => {
    const offsets = virtualLayout().offsets;
    if (offsets.length <= 1) {
      return 0;
    }

    let low = 0;
    let high = offsets.length - 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (offsets[mid + 1] <= offset) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  };

  const virtualWindow = createMemo(() => {
    const totalRows = displayedRows().length;
    const layout = virtualLayout();
    const offsets = layout.offsets;
    const viewportHeight = tableViewportHeight();
    const top = scrollTop();

    if (totalRows === 0) {
      return { start: 0, end: 0, topPadding: 0, bottomPadding: 0 };
    }

    const visibleStart = indexForOffset(top);
    let visibleEnd = visibleStart;
    while (visibleEnd < totalRows && offsets[visibleEnd] < top + viewportHeight) {
      visibleEnd += 1;
    }

    const start = Math.max(0, visibleStart - VIRTUAL_OVERSCAN_ROWS);
    const end = Math.min(totalRows, visibleEnd + VIRTUAL_OVERSCAN_ROWS);
    const topPadding = offsets[start] ?? 0;
    const bottomPadding = Math.max(0, layout.totalHeight - (offsets[end] ?? layout.totalHeight));

    return { start, end, topPadding, bottomPadding };
  });

  const visibleRows = createMemo(() => {
    const { start, end } = virtualWindow();
    return displayedRows().slice(start, end);
  });

  const rowWithDescriptionDrafts = (row: SpellDiffRow): SpellDiffRow => {
    const draft = descriptionDrafts.get(row.row);
    if (!draft) {
      return row;
    }

    return {
      ...row,
      new_description_en: draft.new_description_en ?? row.new_description_en,
      new_description_jp: draft.new_description_jp ?? row.new_description_jp,
    };
  };

  const rowIsEdited = (row: SpellDiffRow) => {
    const rowWithDrafts = rowWithDescriptionDrafts(row);
    return (
      (rowWithDrafts.old_name ?? null) !== (rowWithDrafts.new_name ?? null) ||
      (rowWithDrafts.old_name_jp ?? null) !== (rowWithDrafts.new_name_jp ?? null) ||
      (rowWithDrafts.old_description_en ?? null) !== (rowWithDrafts.new_description_en ?? null) ||
      (rowWithDrafts.old_description_jp ?? null) !== (rowWithDrafts.new_description_jp ?? null) ||
      !stringListsEqual(rowWithDrafts.old_valid_targets, rowWithDrafts.new_valid_targets) ||
      (rowWithDrafts.old_mp_cost ?? null) !== (rowWithDrafts.new_mp_cost ?? null) ||
      (rowWithDrafts.old_cast_time ?? null) !== (rowWithDrafts.new_cast_time ?? null) ||
      (rowWithDrafts.old_recast_time ?? null) !== (rowWithDrafts.new_recast_time ?? null) ||
      (rowWithDrafts.old_range ?? null) !== (rowWithDrafts.new_range ?? null) ||
      (rowWithDrafts.old_radius ?? null) !== (rowWithDrafts.new_radius ?? null) ||
      (rowWithDrafts.old_aoe_type ?? null) !== (rowWithDrafts.new_aoe_type ?? null) ||
      (rowWithDrafts.old_valid_target_type ?? null) !== (rowWithDrafts.new_valid_target_type ?? null) ||
      !spellLevelsEqual(rowWithDrafts.old_level_required, rowWithDrafts.new_level_required)
    );
  };

  const editedRowIds = createMemo(() => {
    rowsVersion();
    const edited = new Set<number>();
    for (const row of rows) {
      if (rowIsEdited(row)) {
        edited.add(row.row);
      }
    }
    return edited;
  });

  const resetLoadedRows = () => {
    setRows([]);
    setRowIndexById(new Map());
    descriptionDrafts.clear();
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

    return "";
  });

  const canLoadSpellFile = createMemo(() =>
    !!getProjectFolder() && !!spellBaseDatMade() && pathIsWithinRoot(spellPath(), getProjectFolder())
  );
  const pathStatusText = createMemo(() => {
    if (!getProjectFolder()) {
      return "Set a Project Folder so Kraken can stage and save spell DAT edits.";
    }
    if (!spellBaseDatMade()) {
      return "This editor only loads the spell DAT from the Project Folder. Click Make Base Spell DAT first so Kraken never edits against retail files.";
    }
    return "This editor loads and saves the spell DAT from the Project Folder.";
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
    const nextHeight = tableContainerRef.clientHeight || 480;
    const nextWidth = tableContainerRef.clientWidth || 960;
    const widthChanged = Math.abs(nextWidth - tableViewportWidth()) > 1;
    if (widthChanged) {
      setRowsVersion((version) => version + 1);
    }
    setTableViewportHeight(nextHeight);
    setTableViewportWidth(nextWidth);
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

  const scheduleTableMeasurement = () => {
    if (tableMeasureFrame !== 0) {
      return;
    }

    tableMeasureFrame = window.requestAnimationFrame(() => {
      tableMeasureFrame = 0;
      syncTableViewport();
    });
  };

  const refreshRowMetrics = () => {
    setRowsVersion((version) => version + 1);
  };

  const loadSpellData = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken can stage and save spell DAT edits.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }
    if (!spellBaseDatMade()) {
      await showMessage("Make the Base Spell DAT first. The Spell Editor loads from Retail Base or Custom so Kraken never edits your retail files.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      return;
    }
    if (!spellPath()) {
      await showMessage("Select the spell DAT/YAML file first.", { title: "Load Blocked", kind: "warning" });
      return;
    }
    if (!pathIsWithinRoot(spellPath(), getProjectFolder())) {
      await showMessage("The Spell Editor only loads spell DATs from the Project Folder. Click Make Base Spell DAT first, then reload the Retail Base copy.", {
        title: "Project Copy Required",
        kind: "warning",
      });
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
          new_name_jp: row.new_name_jp ?? row.old_name_jp,
          new_description_en: row.new_description_en ?? row.old_description_en,
          new_description_jp: row.new_description_jp ?? row.old_description_jp,
          new_valid_targets: row.new_valid_targets ?? row.old_valid_targets ?? [],
          new_index: row.new_index ?? row.old_index,
          new_mp_cost: row.new_mp_cost ?? row.old_mp_cost,
          new_cast_time: row.new_cast_time ?? row.old_cast_time,
          new_recast_time: row.new_recast_time ?? row.old_recast_time,
          new_range: row.new_range ?? row.old_range,
          new_radius: row.new_radius ?? row.old_radius,
          new_aoe_type: row.new_aoe_type ?? row.old_aoe_type,
          new_valid_target_type: row.new_valid_target_type ?? row.old_valid_target_type,
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
      descriptionDrafts.clear();
    } catch (err) {
      await showMessage(`${err}`, { title: "Load Error", kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  const makeBaseSpellDat = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken knows where to place the copied spell DAT.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }

    setMakingBaseDat(true);
    try {
      const copiedPath = unwrap(await copySpellDatToProject());
      await refetchSpellBaseDatMade();
      batch(() => {
        setSpellFile(copiedPath);
        setLastNotice("Copied base spell DAT into Retail Base.");
      });
      await showMessage(`Copied base spell DAT into Retail Base.\n${copiedPath}`, {
        title: "Base DAT Ready",
        kind: "info",
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Copy Error", kind: "error" });
    } finally {
      setMakingBaseDat(false);
    }
  };

  const resetSpellDatToRetailBaseCopy = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first.", { title: "Project Folder Required", kind: "warning" });
      return;
    }
    if (!spellBaseDatMade()) {
      await showMessage("Make the Base Spell DAT first so Kraken has Retail Base files to restore from.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      return;
    }

    const confirmed = await showConfirm(
      "Reset the Spell Editor DATs in Custom back to Retail Base? This overwrites the current Custom spell DAT and spell text DATs.",
      {
        title: "Reset To Retail Base",
        kind: "warning",
        okLabel: "Reset DATs",
        cancelLabel: "Cancel",
      },
    );
    if (confirmed !== true) {
      return;
    }

    setResettingToRetailBase(true);
    try {
      const resetPath = unwrap(await resetSpellDatToRetailBase());
      setSpellPath(resetPath);
      await loadSpellData();
      setLastNotice("Reset spell DATs to Retail Base.");
    } catch (err) {
      await showMessage(`${err}`, { title: "Reset Error", kind: "error" });
    } finally {
      setResettingToRetailBase(false);
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
    const preferred = preferredSpellPath();
    if (!preferred) {
      return;
    }
    if (!spellPath() || !pathIsWithinRoot(spellPath(), getProjectFolder())) {
      setSpellPath(preferred);
    }
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

  createEffect(() => {
    rows.length;
    tableFilter();
    rowsVersion();

    if (typeof window !== "undefined") {
      scheduleTableMeasurement();
    }
  });

  onCleanup(() => {
    if (persistStateTimer !== undefined) {
      window.clearTimeout(persistStateTimer);
    }
    if (scrollFrame !== 0) {
      window.cancelAnimationFrame(scrollFrame);
    }
    if (tableMeasureFrame !== 0) {
      window.cancelAnimationFrame(tableMeasureFrame);
    }
  });

  onMount(() => {
    syncTableViewport();

    const handleResize = () => syncTableViewport();
    window.addEventListener("resize", handleResize);

    if (rows.length === 0 && canLoadSpellFile()) {
      void loadSpellData();
    }

    return () => {
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
  };

  const setRowNewI32 = (rowId: number, key: "new_range" | "new_radius", value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < -128 || parsed > 127) {
      return;
    }

    const rowIndex = rowIndexById().get(rowId);
    if (rowIndex === undefined) {
      return;
    }

    setRows(rowIndex, key, Math.trunc(parsed));
  };

  const setRowNewString = (
    rowId: number,
    key: "new_name" | "new_name_jp" | "new_description_en" | "new_description_jp" | "new_aoe_type" | "new_valid_target_type",
    value: string,
  ) => {
    const rowIndex = rowIndexById().get(rowId);
    if (rowIndex === undefined) {
      return;
    }

    setRows(rowIndex, key, value);
  };

  const setRowNewValidTargets = (rowId: number, values: string[]) => {
    const rowIndex = rowIndexById().get(rowId);
    if (rowIndex === undefined) {
      return;
    }

    setRows(rowIndex, "new_valid_targets", normalizeStringList(values));
  };

  const toggleRowNewValidTarget = (row: SpellDiffRow, target: string, enabled: boolean) => {
    const currentValues = normalizeStringList(row.new_valid_targets ?? row.old_valid_targets);
    const nextValues = enabled
      ? [...currentValues, target]
      : currentValues.filter((value) => value !== target);
    setRowNewValidTargets(row.row, nextValues);
  };

  const descriptionDraftValue = (row: SpellDiffRow, key: "new_description_en" | "new_description_jp") => {
    const draft = descriptionDrafts.get(row.row)?.[key];
    if (typeof draft === "string") {
      return draft;
    }
    return row[key] ?? "";
  };

  const setDescriptionDraft = (rowId: number, key: "new_description_en" | "new_description_jp", value: string) => {
    const current = descriptionDrafts.get(rowId) ?? {};
    current[key] = value;
    descriptionDrafts.set(rowId, current);
  };

  const commitDescriptionDraft = (rowId: number, key: "new_description_en" | "new_description_jp") => {
    const draft = descriptionDrafts.get(rowId)?.[key];
    if (typeof draft !== "string") {
      return;
    }

    setRowNewString(rowId, key, draft);
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

  const resetAllRowsToOriginal = async () => {
    const confirmed = await showConfirm(
      "Are you sure you want to reset ALL loaded spell changes? This cannot be reversed.",
      {
        title: "Reset All Spell Changes",
        kind: "warning",
        okLabel: "Reset All",
        cancelLabel: "Cancel",
      },
    );
    if (confirmed !== true) {
      setLastNotice("Cancelled Reset All.");
      return;
    }

    const resetRows = rows.map((row) => ({
      ...row,
      new_index: row.old_index,
      new_name: row.old_name,
      new_name_jp: row.old_name_jp,
      new_description_en: row.old_description_en,
      new_description_jp: row.old_description_jp,
      new_valid_targets: row.old_valid_targets,
      new_mp_cost: row.old_mp_cost,
      new_cast_time: row.old_cast_time,
      new_recast_time: row.old_recast_time,
      new_range: row.old_range,
      new_radius: row.old_radius,
      new_aoe_type: row.old_aoe_type,
      new_valid_target_type: row.old_valid_target_type,
      new_level_required: row.old_level_required,
    }));

    batch(() => {
      descriptionDrafts.clear();
      for (const key of Object.keys(levelDrafts)) {
        delete levelDrafts[Number(key)];
      }
      setRows(() => resetRows);
      setLastNotice(`Reset ${resetRows.length} spell rows to original values.`);
      setRowsVersion((version) => version + 1);
    });
  };

  const saveEdited = async () => {
    if (rows.length === 0) {
      await showMessage("Load the spell file first.", { title: "Save Blocked", kind: "warning" });
      return;
    }
    if (!pathIsWithinRoot(spellPath(), getProjectFolder())) {
      await showMessage("The Spell Editor only saves from Project Folder copies. Click Make Base Spell DAT first, then reload the Retail Base copy.", {
        title: "Project Copy Required",
        kind: "warning",
      });
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

    const payloadRows = rows.map((row) => ({ ...rowWithDescriptionDrafts(row), choice: "New" as const }));

    setSaving(true);
    try {
      const result = unwrap(await saveSpellDiff(spellPath(), spellPath(), payloadRows, outYamlPath, outDatPath));
      const savedYamlPath = projectDisplayPath(result.out_yaml_path, getProjectFolder());
      const savedDatPath = projectDisplayPath(result.out_dat_path, getProjectFolder());
      const spellNamesEnPath = projectDisplayPath(result.spell_names_en_path, getProjectFolder());
      const spellNamesJpPath = projectDisplayPath(result.spell_names_jp_path, getProjectFolder());
      const spellDescriptionsEnPath = projectDisplayPath(result.spell_descriptions_en_path, getProjectFolder());
      const spellDescriptionsJpPath = projectDisplayPath(result.spell_descriptions_jp_path, getProjectFolder());
      setLastSavedYamlPath(savedYamlPath);
      setLastSavedDatPath(savedDatPath);
      if (result.out_dat_path) {
        setSpellPath(result.out_dat_path);
      }
      setLastNotice(`Saved ${result.written_count} spell entries.`);
      await showMessage(
        `Saved ${result.written_count} spell entries.\nData YAML: ${savedYamlPath}${savedDatPath ? `\nData DAT: ${savedDatPath}` : ""}${spellNamesEnPath ? `\nNames EN DAT: ${spellNamesEnPath}` : ""}${spellNamesJpPath ? `\nNames JP DAT: ${spellNamesJpPath}` : ""}${spellDescriptionsEnPath ? `\nDescriptions EN DAT: ${spellDescriptionsEnPath}` : ""}${spellDescriptionsJpPath ? `\nDescriptions JP DAT: ${spellDescriptionsJpPath}` : ""}`,
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
          <div class="rounded-md border border-amber-700/60 bg-amber-950/15 px-3 py-2">
            <div class="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-200">Direct Edit Workflow</div>
            <div class="mt-1 text-[13px] text-amber-100">
              This editor uses a copied spell DAT in the Project Folder so Kraken never edits your retail FFXI files directly.
            </div>
            <div class="mt-3">
              <button
                class={`${compactButtonClass()} ${spellBaseDatMade() ? "opacity-60 cursor-not-allowed" : ""}`}
                disabled={isLoading() || isSaving() || isMakingBaseDat() || !getProjectFolder() || !!spellBaseDatMade()}
                onclick={makeBaseSpellDat}
              >
                {isMakingBaseDat() ? "Making base spell DAT..." : spellBaseDatMade() ? "Base Spell DAT Made" : "Make Base Spell DAT"}
              </button>
            </div>
          </div>

          <div class="min-w-0 flex items-center gap-2">
            <button class={compactButtonClass()} disabled={!getProjectFolder()} onclick={pickFile}>Spell DAT/YAML</button>
            <span class="font-mono text-xs truncate" title={spellPath() || "Not selected"}>
              {spellPath() || "Not selected"}
            </span>
          </div>

          <div class="text-[11px] text-slate-400">
            {pathStatusText()}
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class={compactButtonClass()} disabled={isLoading() || isSaving() || isMakingBaseDat() || !canLoadSpellFile()} onclick={loadSpellData}>
              {isLoading() ? "Reloading..." : "Reload"}
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

          <Show when={rows.length > 0}>
            <div class="flex flex-wrap items-center gap-1 text-xs">
              <span class="mr-1 text-slate-400">Hide columns:</span>
              <button class={compactButtonClass(showNamesColumn())} onClick={() => {
                setShowNamesColumn((visible) => !visible);
                refreshRowMetrics();
              }}>Names</button>
              <button class={compactButtonClass(showTimingColumns())} onClick={() => {
                setShowTimingColumns((visible) => !visible);
                refreshRowMetrics();
              }}>Editable Values</button>
              <button class={compactButtonClass(showValidTargetsColumn())} onClick={() => {
                setShowValidTargetsColumn((visible) => !visible);
                refreshRowMetrics();
              }}>Targets</button>
              <button class={compactButtonClass(showDescriptionsColumn())} onClick={() => {
                setShowDescriptionsColumn((visible) => !visible);
                refreshRowMetrics();
              }}>Descriptions</button>
              <button class={compactButtonClass(showLevelColumn())} onClick={() => {
                setShowLevelColumn((visible) => !visible);
                refreshRowMetrics();
              }}>Level</button>
            </div>
          </Show>

          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
            <Show when={lastNotice()}>
              <div class="italic text-slate-300">{lastNotice()}</div>
            </Show>
            <Show when={rows.length > 0}>
              <div class="flex flex-col items-end gap-1">
                <div class="text-slate-300">
                  Loaded: {rows.length} | Edited: {editedRowIds().size}
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    class={compactButtonClass()}
                    disabled={isLoading() || isSaving() || isMakingBaseDat() || isResettingToRetailBase() || !spellBaseDatMade()}
                    onClick={() => {
                      void resetSpellDatToRetailBaseCopy();
                    }}
                  >
                    {isResettingToRetailBase() ? "Resetting..." : "Reset DATs to Retail Base"}
                  </button>
                  <button
                    class={compactButtonClass()}
                    disabled={editedRowIds().size === 0}
                    onClick={() => {
                      void resetAllRowsToOriginal();
                    }}
                  >
                    Reset All
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>

        <Show when={rows.length > 0}>
          <div
            class="max-h-[70vh] overflow-y-auto overflow-x-hidden border border-slate-700 rounded-md"
            ref={(el) => {
              tableContainerRef = el;
            }}
            onScroll={onTableScroll}
          >
            <table class="w-full table-fixed">
              <colgroup>
                <col style={{ width: `${INDEX_COLUMN_WEIGHT}%` }} />
                <Show when={showNamesColumn()}>
                  <col style={{ width: `${NAMES_COLUMN_WEIGHT}%` }} />
                </Show>
                <Show when={showTimingColumns()}>
                  <col style={{ width: `${EDITABLE_VALUES_COLUMN_WEIGHT}%` }} />
                </Show>
                <Show when={showValidTargetsColumn()}>
                  <col style={{ width: `${VALID_TARGETS_COLUMN_WEIGHT}%` }} />
                </Show>
                <Show when={showDescriptionsColumn()}>
                  <col style={{ width: `${DESCRIPTION_COLUMN_WEIGHT}%` }} />
                  <col style={{ width: `${DESCRIPTION_COLUMN_WEIGHT}%` }} />
                </Show>
                <Show when={showLevelColumn()}>
                  <col style={{ width: `${LEVEL_COLUMN_WEIGHT}%` }} />
                </Show>
              </colgroup>
              <thead class="sticky top-0 z-10">
                <tr>
                  <th>Index</th>
                  <Show when={showNamesColumn()}>
                    <th>Names</th>
                  </Show>
                  <Show when={showTimingColumns()}>
                    <th>Editable Values</th>
                  </Show>
                  <Show when={showValidTargetsColumn()}>
                    <th>Valid Targets</th>
                  </Show>
                  <Show when={showDescriptionsColumn()}>
                    <th>Description (EN)</th>
                    <th>Description (JP)</th>
                  </Show>
                  <Show when={showLevelColumn()}>
                    <th>Level</th>
                  </Show>
                </tr>
              </thead>
              <tbody>
                <Show when={virtualWindow().topPadding > 0}>
                  <tr>
                    <td colSpan={spellEditorColumnCount()} style={{ height: `${virtualWindow().topPadding}px`, padding: "0", border: "0" }}></td>
                  </tr>
                </Show>

                <For each={visibleRows()}>
                  {(row) => {
                    return (
                    <tr>
                      {(() => {
                        const rowMetrics = virtualLayout().metricsByRow.get(row.row) ?? DEFAULT_ROW_METRICS;
                        const currentValidTargets = normalizeStringList(row.new_valid_targets ?? row.old_valid_targets);
                        const validTargetsChanged = !stringListsEqual(row.old_valid_targets, row.new_valid_targets);
                        const editableValuesChanged =
                          (row.old_mp_cost ?? null) !== (row.new_mp_cost ?? null) ||
                          (row.old_cast_time ?? null) !== (row.new_cast_time ?? null) ||
                          (row.old_recast_time ?? null) !== (row.new_recast_time ?? null) ||
                          (row.old_range ?? null) !== (row.new_range ?? null) ||
                          (row.old_radius ?? null) !== (row.new_radius ?? null) ||
                          (row.old_aoe_type ?? null) !== (row.new_aoe_type ?? null) ||
                          (row.old_valid_target_type ?? null) !== (row.new_valid_target_type ?? null);
                        return (
                          <>
                      <td class="font-mono truncate">{row.new_index ?? row.old_index ?? "-"}</td>
                      <Show when={showNamesColumn()}>
                        <td class="min-w-0">
                          <div class="flex min-w-0 flex-col gap-1">
                            <input
                              class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_name ?? null) !== (row.new_name ?? null))}`}
                              type="text"
                              value={row.new_name ?? ""}
                              placeholder="EN"
                              title={row.new_name ?? row.old_name ?? ""}
                              onInput={(e) => setRowNewString(row.row, "new_name", e.currentTarget.value)}
                            />
                            <input
                              class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_name_jp ?? null) !== (row.new_name_jp ?? null))}`}
                              type="text"
                              value={row.new_name_jp ?? ""}
                              placeholder="JP"
                              title={row.new_name_jp ?? row.old_name_jp ?? ""}
                              onInput={(e) => setRowNewString(row.row, "new_name_jp", e.currentTarget.value)}
                            />
                          </div>
                        </td>
                      </Show>
                      <Show when={showTimingColumns()}>
                        <td class={newFieldClass(editableValuesChanged)}>
                          <div class="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1 rounded-md border border-slate-500 px-2 py-1">
                            <div class="flex min-w-0 flex-col gap-1">
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>MP</span>
                                <input
                                  class={`${COMPACT_VALUE_INPUT_CLASS} ${newFieldClass((row.old_mp_cost ?? null) !== (row.new_mp_cost ?? null))}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.new_mp_cost ?? ""}
                                  onInput={(e) => setRowNewU32(row.row, "new_mp_cost", e.currentTarget.value)}
                                />
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Cast</span>
                                <input
                                  class={`${COMPACT_VALUE_INPUT_CLASS} ${newFieldClass((row.old_cast_time ?? null) !== (row.new_cast_time ?? null))}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.new_cast_time ?? ""}
                                  onInput={(e) => setRowNewU32(row.row, "new_cast_time", e.currentTarget.value)}
                                />
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Recast</span>
                                <input
                                  class={`${COMPACT_VALUE_INPUT_CLASS} ${newFieldClass((row.old_recast_time ?? null) !== (row.new_recast_time ?? null))}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.new_recast_time ?? ""}
                                  onInput={(e) => setRowNewU32(row.row, "new_recast_time", e.currentTarget.value)}
                                />
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Range</span>
                                <input
                                  class={`${COMPACT_VALUE_INPUT_CLASS} ${newFieldClass((row.old_range ?? null) !== (row.new_range ?? null))}`}
                                  type="number"
                                  min={-128}
                                  max={127}
                                  step={1}
                                  value={row.new_range ?? ""}
                                  onInput={(e) => setRowNewI32(row.row, "new_range", e.currentTarget.value)}
                                />
                              </label>
                            </div>
                            <div class="flex min-w-0 flex-col gap-1">
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Radius</span>
                                <input
                                  class={`${COMPACT_VALUE_INPUT_CLASS} ${newFieldClass((row.old_radius ?? null) !== (row.new_radius ?? null))}`}
                                  type="number"
                                  min={-128}
                                  max={127}
                                  step={1}
                                  value={row.new_radius ?? ""}
                                  onInput={(e) => setRowNewI32(row.row, "new_radius", e.currentTarget.value)}
                                />
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>AoE</span>
                                <select
                                  class={`${COMPACT_VALUE_SELECT_CLASS} ${newFieldClass((row.old_aoe_type ?? null) !== (row.new_aoe_type ?? null))}`}
                                  value={row.new_aoe_type ?? ""}
                                  onChange={(e) => setRowNewString(row.row, "new_aoe_type", e.currentTarget.value)}
                                >
                                  <For each={AOE_TYPE_OPTIONS}>
                                    {(option) => <option value={option}>{option}</option>}
                                  </For>
                                </select>
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Type</span>
                                <select
                                  class={`${COMPACT_VALUE_SELECT_CLASS} ${newFieldClass((row.old_valid_target_type ?? null) !== (row.new_valid_target_type ?? null))}`}
                                  value={row.new_valid_target_type ?? ""}
                                  onChange={(e) => setRowNewString(row.row, "new_valid_target_type", e.currentTarget.value)}
                                >
                                  <For each={VALID_TARGET_TYPE_OPTIONS}>
                                    {(option) => <option value={option}>{option}</option>}
                                  </For>
                                </select>
                              </label>
                            </div>
                          </div>
                        </td>
                      </Show>
                      <Show when={showValidTargetsColumn()}>
                        <td class={newFieldClass(validTargetsChanged)}>
                          <div
                            class="grid grid-cols-3 gap-x-1 gap-y-0.5 overflow-hidden rounded-md border border-slate-500 px-1.5 py-1 text-[11px] leading-4"
                            style={{ height: `${rowMetrics.validTargetsHeight}px` }}
                          >
                            <For each={validTargetOptionsForValues(row.old_valid_targets, row.new_valid_targets)}>
                              {(target) => (
                                <label class="m-0 flex min-w-0 items-center gap-1 font-normal normal-case text-slate-100" title={target}>
                                  <input
                                    class="!m-0 !h-3 !w-3 shrink-0"
                                    type="checkbox"
                                    checked={currentValidTargets.includes(target)}
                                    onChange={(e) => toggleRowNewValidTarget(row, target, e.currentTarget.checked)}
                                  />
                                  <span class="truncate">{validTargetLabel(target)}</span>
                                </label>
                              )}
                            </For>
                          </div>
                        </td>
                      </Show>
                      <Show when={showDescriptionsColumn()}>
                        <td class={newFieldClass((row.old_description_en ?? null) !== (row.new_description_en ?? null))}>
                          <textarea
                            class={`m-0 w-full overflow-hidden py-0.5 px-2 text-sm leading-5 resize-none rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_description_en ?? null) !== (row.new_description_en ?? null))}`}
                            style={{ height: `${rowMetrics.descriptionEnHeight}px` }}
                            ref={(el) => {
                              el.value = descriptionDraftValue(row, "new_description_en");
                            }}
                            title={row.new_description_en ?? row.old_description_en ?? ""}
                            onInput={(e) => {
                              setDescriptionDraft(row.row, "new_description_en", e.currentTarget.value);
                            }}
                            onBlur={() => {
                              commitDescriptionDraft(row.row, "new_description_en");
                              refreshRowMetrics();
                            }}
                          />
                        </td>
                        <td class={newFieldClass((row.old_description_jp ?? null) !== (row.new_description_jp ?? null))}>
                          <textarea
                            class={`m-0 w-full overflow-hidden py-0.5 px-2 text-sm leading-5 resize-none rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_description_jp ?? null) !== (row.new_description_jp ?? null))}`}
                            style={{ height: `${rowMetrics.descriptionJpHeight}px` }}
                            ref={(el) => {
                              el.value = descriptionDraftValue(row, "new_description_jp");
                            }}
                            title={row.new_description_jp ?? row.old_description_jp ?? ""}
                            onInput={(e) => {
                              setDescriptionDraft(row.row, "new_description_jp", e.currentTarget.value);
                            }}
                            onBlur={() => {
                              commitDescriptionDraft(row.row, "new_description_jp");
                              refreshRowMetrics();
                            }}
                          />
                        </td>
                      </Show>
                      <Show when={showLevelColumn()}>
                        <td class={newFieldClass(formatLevels(row.old_level_required ?? null) !== formatLevels(row.new_level_required ?? null))}>
                          <textarea
                            class={`m-0 w-full overflow-hidden py-0.5 px-2 text-sm font-mono leading-5 resize-none rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass(formatLevels(row.old_level_required ?? null) !== formatLevels(row.new_level_required ?? null))}`}
                            style={{ height: `${rowMetrics.levelHeight}px` }}
                            value={levelInputValue(row)}
                            onInput={(e) => {
                              setLevelDraft(row.row, e.currentTarget.value);
                            }}
                            onBlur={() => {
                              void applyLevelDraft(row.row);
                              refreshRowMetrics();
                            }}
                          />
                        </td>
                      </Show>
                          </>
                        );
                      })()}
                    </tr>
                    );
                  }}
                </For>

                <Show when={virtualWindow().bottomPadding > 0}>
                  <tr>
                    <td colSpan={spellEditorColumnCount()} style={{ height: `${virtualWindow().bottomPadding}px`, padding: "0", border: "0" }}></td>
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
