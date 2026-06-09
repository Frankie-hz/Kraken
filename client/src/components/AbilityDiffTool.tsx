import { open } from "@tauri-apps/plugin-dialog";
import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createEffect, createMemo, createResource, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { AbilityDiffRow, compareAbilityFiles, copyAbilityDatToProject, isAbilityDatMadeInProject, resetAbilityDatToRetailBase, saveAbilityDiff } from "../custom_bindings";
import { showConfirm, showMessage } from "../dialogs";
import { useData } from "../store";
import { projectDisplayPath, unwrap } from "../util";

const ROW_CHANGED_MARKER_CLASS = "border-l-2 border-sky-400/80 bg-sky-950/20";
const CHANGE_DOT_CLASS = "pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-300 shadow-[0_0_4px_rgba(125,211,252,0.8)]";
const MAX_EDITABLE_ABILITY_ID = 1310;

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

const SPELL_DISTANCE_OPTIONS = ["None", "D1", "D3", "D4", "D5", "D6", "D7", "D8", "D10", "D12", "D14", "D16", "D20", "D25", "D30", "SelfTarget"];
const AREA_SHAPE_OPTIONS = ["Single", "Sphere", "Cone", "CasterSphere"];
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

const COMPACT_VALUE_INPUT_CLASS = "hide-spin-buttons m-0 min-w-0 w-full py-0 px-1 text-xs font-mono rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none";
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

function rowMatchesFilter(row: AbilityDiffRow, filterText: string) {
  const name = row.new_name ?? row.old_name ?? "";
  const nameJp = row.new_name_jp ?? row.old_name_jp ?? "";
  const descriptionEn = row.new_description_en ?? row.old_description_en ?? "";
  const descriptionJp = row.new_description_jp ?? row.old_description_jp ?? "";
  const validTargets = normalizeStringList(row.new_valid_targets ?? row.old_valid_targets).join(" ");

  const haystack = [
    name,
    nameJp,
    row.new_id ?? row.old_id,
    row.new_charges_required ?? row.old_charges_required,
    row.new_range ?? row.old_range,
    row.new_aoe_range ?? row.old_aoe_range,
    row.new_area_shape ?? row.old_area_shape,
    row.new_valid_target_type ?? row.old_valid_target_type,
    descriptionEn,
    descriptionJp,
    validTargets,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => `${value}`.toLowerCase())
    .join(" ");

  return haystack.includes(filterText);
}

function rowIsEditableAbility(row: AbilityDiffRow) {
  const id = row.new_id ?? row.old_id;
  return id !== null && id !== undefined && id <= MAX_EDITABLE_ABILITY_ID;
}

function buildRowIndexById(rows: AbilityDiffRow[]) {
  const indexById = new Map<number, number>();
  rows.forEach((row, index) => {
    indexById.set(row.row, index);
  });
  return indexById;
}

const compactButtonBaseClass = "my-0 px-1.5 py-0.5 text-xs font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
const compactButtonActiveClass = "bg-green-800 border-green-500 text-slate-100";

const ABILITY_RELATIVE_PATH = "ROM/118/114.DAT";
const ABILITY_EDITOR_STATE_KEY = "xi_tinkerer_ability_editor_state_v1";

const MIN_VIRTUAL_ROW_HEIGHT_PX = 64;
const VIRTUAL_OVERSCAN_ROWS = 12;
const TEXTAREA_MIN_HEIGHT_PX = 52;
const TEXTAREA_LINE_HEIGHT_PX = 20;
const TEXTAREA_VERTICAL_CHROME_PX = 12;
const TEXTAREA_WRAP_SAFETY_PX = 10;
const TEXTAREA_ROW_PADDING_PX = 12;
const VALID_TARGET_ROW_HEIGHT_PX = 18;
const EDITABLE_VALUES_MIN_HEIGHT_PX = 96;

// Weighted realtive to each other
const INDEX_COLUMN_WEIGHT = 5;
const NAMES_COLUMN_WEIGHT = 13;
const EDITABLE_VALUES_COLUMN_WEIGHT = 22;
const VALID_TARGETS_COLUMN_WEIGHT = 22;
const DESCRIPTION_COLUMN_WEIGHT = 18.5;

const DEFAULT_ROW_METRICS = {
  descriptionEnHeight: TEXTAREA_MIN_HEIGHT_PX,
  descriptionJpHeight: TEXTAREA_MIN_HEIGHT_PX,
  validTargetsHeight: TEXTAREA_MIN_HEIGHT_PX,
  rowHeight: MIN_VIRTUAL_ROW_HEIGHT_PX,
};

type AbilityEditableValueKey = "new_charges_required";

interface AbilityEditorCachedState {
  ability_path: string;
  rows?: AbilityDiffRow[];
  table_filter: string;
  show_edited_only?: boolean;
  last_notice: string;
  last_saved_yaml_path: string;
  last_saved_dat_path: string;
}

function compactButtonClass(active = false) {
  return `${compactButtonBaseClass} ${active ? compactButtonActiveClass : compactButtonIdleClass}`;
}

function abilityPathFromProjectRoot(projectRoot: string | null): string | null {
  if (!projectRoot) {
    return null;
  }

  const normalizedRoot = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return `${normalizedRoot}/Custom/${ABILITY_RELATIVE_PATH}`;
}

function loadCachedState(): AbilityEditorCachedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(ABILITY_EDITOR_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as AbilityEditorCachedState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function AbilityDiffTool() {
  const {
    folders: { getProjectFolder },
  } = useData();
  const [searchParams] = useSearchParams();
  const cachedState = loadCachedState();

  const [abilityPath, setAbilityPath] = createSignal(cachedState?.ability_path ?? "");
  const [rows, setRows] = createStore<AbilityDiffRow[]>(cachedState?.rows ?? []);
  const [rowIndexById, setRowIndexById] = createSignal<Map<number, number>>(buildRowIndexById(cachedState?.rows ?? []));
  const [tableFilter, setTableFilter] = createSignal(cachedState?.table_filter ?? "");
  const [showEditedOnly, setShowEditedOnly] = createSignal(cachedState?.show_edited_only ?? false);
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [lastSavedYamlPath, setLastSavedYamlPath] = createSignal(cachedState?.last_saved_yaml_path ?? "");
  const [lastSavedDatPath, setLastSavedDatPath] = createSignal(cachedState?.last_saved_dat_path ?? "");

  const [isLoading, setLoading] = createSignal(false);
  const [isSaving, setSaving] = createSignal(false);
  const [isMakingBaseDat, setMakingBaseDat] = createSignal(false);
  const [isUpdatingBaseDat, setUpdatingBaseDat] = createSignal(false);
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

  let tableContainerRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let tableMeasureFrame = 0;
  let persistStateTimer: number | undefined;
  const nameDrafts = new Map<number, Partial<Pick<AbilityDiffRow, "new_name" | "new_name_jp">>>();
  const descriptionDrafts = new Map<number, Partial<Pick<AbilityDiffRow, "new_description_en" | "new_description_jp">>>();
  const editableValueDrafts = new Map<number, Partial<Record<AbilityEditableValueKey, string>>>();

  const [abilityBaseDatMade, { refetch: refetchabilityBaseDatMade }] = createResource(
    () => getProjectFolder(),
    async (projectFolder) => {
      if (!projectFolder) {
        return false;
      }
      return unwrap(await isAbilityDatMadeInProject());
    },
  );

  const displayedRows = createMemo(() => {
    const filterText = tableFilter().trim().toLowerCase();
    return rows.filter((row) => {
      if (showEditedOnly() && !rowIsEdited(row)) {
        return false;
      }
      if (!filterText) {
        return true;
      }
      return rowMatchesFilter(row, filterText);
    });
  });

  const abilityEditorColumnCount = createMemo(() =>
    1 +
    (showNamesColumn() ? 1 : 0) +
    (showTimingColumns() ? 1 : 0) +
    (showValidTargetsColumn() ? 1 : 0) +
    (showDescriptionsColumn() ? 2 : 0)
  );

  const virtualLayout = createMemo(() => {
    rowsVersion();
    tableFilter();
    showEditedOnly();
    const descriptionsVisible = showDescriptionsColumn();
    const validTargetsVisible = showValidTargetsColumn();
    const currentRows = untrack(() => displayedRows().slice());
    const tableWidth = Math.max(640, tableViewportWidth());
    const activeColumnWeight =
      INDEX_COLUMN_WEIGHT +
      (showNamesColumn() ? NAMES_COLUMN_WEIGHT : 0) +
      (showTimingColumns() ? EDITABLE_VALUES_COLUMN_WEIGHT : 0) +
      (validTargetsVisible ? VALID_TARGETS_COLUMN_WEIGHT : 0) +
      (descriptionsVisible ? DESCRIPTION_COLUMN_WEIGHT * 2 : 0);
    const widthForWeight = (weight: number, minimumWidth: number) =>
      Math.max(minimumWidth, tableWidth * (weight / activeColumnWeight) - 24);
    const descriptionColumnWidth = widthForWeight(DESCRIPTION_COLUMN_WEIGHT, 120);
    const enCharsPerLine = Math.max(12, Math.floor(descriptionColumnWidth / 7.2));
    const jpCharsPerLine = Math.max(8, Math.floor(descriptionColumnWidth / 13));

    const offsets = [0];
    const metricsByRow = new Map<number, typeof DEFAULT_ROW_METRICS>();

    for (const row of currentRows) {
      const descriptionEnLines = descriptionsVisible
        ? estimateWrappedLines(row.new_description_en ?? row.old_description_en, enCharsPerLine)
        : 1;
      const descriptionJpLines = descriptionsVisible
        ? estimateWrappedLines(row.new_description_jp ?? row.old_description_jp, jpCharsPerLine)
        : 1;
      const targetLines = validTargetsVisible
        ? Math.ceil(validTargetOptionsForValues(row.old_valid_targets, row.new_valid_targets).length / 3)
        : 1;

      const descriptionEnHeight = Math.max(TEXTAREA_MIN_HEIGHT_PX, descriptionEnLines * TEXTAREA_LINE_HEIGHT_PX + TEXTAREA_VERTICAL_CHROME_PX + TEXTAREA_WRAP_SAFETY_PX);
      const descriptionJpHeight = Math.max(TEXTAREA_MIN_HEIGHT_PX, descriptionJpLines * TEXTAREA_LINE_HEIGHT_PX + TEXTAREA_VERTICAL_CHROME_PX + TEXTAREA_WRAP_SAFETY_PX);
      const validTargetsHeight = Math.max(TEXTAREA_MIN_HEIGHT_PX, targetLines * VALID_TARGET_ROW_HEIGHT_PX + TEXTAREA_VERTICAL_CHROME_PX);
      const editableValuesHeight = showTimingColumns() ? EDITABLE_VALUES_MIN_HEIGHT_PX : TEXTAREA_MIN_HEIGHT_PX;
      const controlHeight = Math.max(
        MIN_VIRTUAL_ROW_HEIGHT_PX,
        editableValuesHeight,
        descriptionEnHeight,
        descriptionJpHeight,
        validTargetsHeight,
      );
      const rowHeight = controlHeight + TEXTAREA_ROW_PADDING_PX;

      metricsByRow.set(row.row, {
        descriptionEnHeight: controlHeight,
        descriptionJpHeight: controlHeight,
        validTargetsHeight: controlHeight,
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

  function rowWithDrafts(row: AbilityDiffRow): AbilityDiffRow {
    const nameDraft = nameDrafts.get(row.row);
    const descriptionDraft = descriptionDrafts.get(row.row);
    const rowWithDrafts = {
      ...row,
      new_name: nameDraft?.new_name ?? row.new_name,
      new_name_jp: nameDraft?.new_name_jp ?? row.new_name_jp,
      new_description_en: descriptionDraft?.new_description_en ?? row.new_description_en,
      new_description_jp: descriptionDraft?.new_description_jp ?? row.new_description_jp,
    };

    const valueDraft = editableValueDrafts.get(row.row);
    if (!valueDraft) {
      return rowWithDrafts;
    }

    for (const [key, value] of Object.entries(valueDraft) as Array<[AbilityEditableValueKey, string]>) {
      const parsed = parseEditableValueDraft(key, value);
      if (parsed !== null) {
        rowWithDrafts[key] = parsed as never;
      }
    }

    return rowWithDrafts;
  }

  function rowIsEdited(row: AbilityDiffRow) {
    const draftRow = rowWithDrafts(row);
    return (
      (draftRow.old_name ?? null) !== (draftRow.new_name ?? null) ||
      (draftRow.old_name_jp ?? null) !== (draftRow.new_name_jp ?? null) ||
      (draftRow.old_description_en ?? null) !== (draftRow.new_description_en ?? null) ||
      (draftRow.old_description_jp ?? null) !== (draftRow.new_description_jp ?? null) ||
      !stringListsEqual(draftRow.old_valid_targets, draftRow.new_valid_targets) ||
      (draftRow.old_charges_required ?? null) !== (draftRow.new_charges_required ?? null) ||
      (draftRow.old_range ?? null) !== (draftRow.new_range ?? null) ||
      (draftRow.old_aoe_range ?? null) !== (draftRow.new_aoe_range ?? null) ||
      (draftRow.old_area_shape ?? null) !== (draftRow.new_area_shape ?? null) ||
      (draftRow.old_valid_target_type ?? null) !== (draftRow.new_valid_target_type ?? null)
    );
  }

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
    nameDrafts.clear();
    descriptionDrafts.clear();
    editableValueDrafts.clear();
    setRowsVersion((version) => version + 1);
  };

  const preferredAbilityPath = createMemo(() => {
    if (!abilityBaseDatMade()) {
      return "";
    }

    const abilityPathFromProject = abilityPathFromProjectRoot(getProjectFolder());
    if (abilityPathFromProject) {
      return abilityPathFromProject;
    }

    return "";
  });

  const canLoadAbilityFile = createMemo(() =>
    !!getProjectFolder() && !!abilityBaseDatMade() && pathIsWithinRoot(abilityPath(), getOutputRoot(getProjectFolder()))
  );
  const abilityDisplayPath = createMemo(() => projectDisplayPath(abilityPath(), getProjectFolder()));
  const pathStatusText = createMemo(() => {
    if (!getProjectFolder()) {
      return "Set a Project Folder so Kraken can stage and save Ability DAT edits.";
    }
    if (!abilityBaseDatMade()) {
      return "Click Make Base Ability DAT to create a Retail Base snapshot and a Custom editor copy.";
    }
    return "This editor loads and saves the Custom Ability DAT. Retail Base is kept for reset and can be updated from FFXI Source.";
  });

  const setAbilityFile = (path: string) => {
    setAbilityPath(path);
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

  const loadAbilityData = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken can stage and save Ability DAT edits.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }
    if (!abilityBaseDatMade()) {
      await showMessage("Make the Base Ability DAT first. The Ability Editor loads and saves from Custom so Kraken never edits your retail files.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      return;
    }
    if (!abilityPath()) {
      await showMessage("Select the Ability DAT/YAML file first.", { title: "Load Blocked", kind: "warning" });
      return;
    }
    if (!pathIsWithinRoot(abilityPath(), getOutputRoot(getProjectFolder()))) {
      await showMessage("The Ability Editor only loads Ability DATs from Custom. Click Make Base Ability DAT first, then use the Custom copy.", {
        title: "Project Copy Required",
        kind: "warning",
      });
      return;
    }

    setLoading(true);
    try {
      const result = unwrap(await compareAbilityFiles(abilityPath(), abilityPath()));
      batch(() => {
        const preparedRows = result.rows.filter(rowIsEditableAbility).map((row) => ({
          ...row,
          choice: "New",
          new_name: row.new_name ?? row.old_name,
          new_name_jp: row.new_name_jp ?? row.old_name_jp,
          new_description_en: row.new_description_en ?? row.old_description_en,
          new_description_jp: row.new_description_jp ?? row.old_description_jp,
          new_valid_targets: row.new_valid_targets ?? row.old_valid_targets ?? [],
          new_id: row.new_id ?? row.old_id,
          new_charges_required: row.new_charges_required ?? row.old_charges_required,
          new_range: row.new_range ?? row.old_range,
          new_aoe_range: row.new_aoe_range ?? row.old_aoe_range,
          new_area_shape: row.new_area_shape ?? row.old_area_shape,
          new_valid_target_type: row.new_valid_target_type ?? row.old_valid_target_type,
        }));
        setRows(() => preparedRows);
        setRowIndexById(buildRowIndexById(preparedRows));
        setLastNotice("");
        setRowsVersion((version) => version + 1);
      });
      nameDrafts.clear();
      descriptionDrafts.clear();
      editableValueDrafts.clear();
    } catch (err) {
      await showMessage(`${err}`, { title: "Load Error", kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  const makeBaseAbilityDat = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken knows where to place the copied Ability DAT.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }

    setMakingBaseDat(true);
    try {
      const copiedPath = unwrap(await copyAbilityDatToProject());
      await refetchabilityBaseDatMade();
      batch(() => {
        setAbilityFile(copiedPath);
        setLastNotice("Copied Base Ability DAT into Retail Base and Custom.");
      });
      await showMessage(`Copied Base Ability DAT into Retail Base and Custom.\nCustom DAT: ${copiedPath}`, {
        title: "Base DAT Ready",
        kind: "info",
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Copy Error", kind: "error" });
    } finally {
      setMakingBaseDat(false);
    }
  };

  const updateBaseAbilityDatFromSource = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken knows where to update the Base Ability DAT.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }
    if (!abilityBaseDatMade()) {
      await showMessage("Make the Base Ability DAT first before updating it from FFXI Source.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      return;
    }

    setUpdatingBaseDat(true);
    try {
      const customPath = unwrap(await copyAbilityDatToProject());
      await refetchabilityBaseDatMade();
      batch(() => {
        if (!abilityPath()) {
          setAbilityPath(customPath);
        }
        setLastNotice("Updated Retail Base Ability DAT from FFXI Source. Custom Ability DAT was not overwritten.");
      });
      await showMessage(
        `Updated Retail Base Ability DAT from FFXI Source.\nCustom DAT kept at: ${customPath}`,
        {
          title: "Base DAT Updated",
          kind: "info",
        },
      );
    } catch (err) {
      await showMessage(`${err}`, { title: "Update Error", kind: "error" });
    } finally {
      setUpdatingBaseDat(false);
    }
  };

  const resetAbilityDatToRetailBaseCopy = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first.", { title: "Project Folder Required", kind: "warning" });
      return;
    }
    if (!abilityBaseDatMade()) {
      await showMessage("Make the Base Ability DAT first so Kraken has Retail Base files to restore from.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      return;
    }

    const confirmed = await showConfirm(
      "Reset the Ability Editor DATs in Custom back to Retail Base? This overwrites the current Custom Ability DAT and ability text DATs.",
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
      const resetPath = unwrap(await resetAbilityDatToRetailBase());
      setAbilityPath(resetPath);
      await loadAbilityData();
      setLastNotice("Reset Ability DATs to Retail Base.");
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
        setAbilityFile(fromQuery);
      }
      setPrefillApplied(true);
    });
  });

  createEffect(() => {
    const preferred = preferredAbilityPath();
    if (!preferred) {
      return;
    }
    if (!abilityPath() || !pathIsWithinRoot(abilityPath(), getOutputRoot(getProjectFolder()))) {
      setAbilityPath(preferred);
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    abilityPath();
    rowsVersion();
    tableFilter();
    showEditedOnly();
    lastNotice();
    lastSavedYamlPath();
    lastSavedDatPath();

    if (persistStateTimer !== undefined) {
      window.clearTimeout(persistStateTimer);
    }

    persistStateTimer = window.setTimeout(() => {
      const stateToSave: AbilityEditorCachedState = {
        ability_path: abilityPath(),
        table_filter: tableFilter(),
        show_edited_only: showEditedOnly(),
        last_notice: lastNotice(),
        last_saved_yaml_path: lastSavedYamlPath(),
        last_saved_dat_path: lastSavedDatPath(),
      };

      try {
        window.sessionStorage.setItem(ABILITY_EDITOR_STATE_KEY, JSON.stringify(stateToSave));
      } catch (error) {
        console.warn("Failed to persist Ability Editor UI state.", error);
      }
      persistStateTimer = undefined;
    }, 250);
  });

  createEffect(() => {
    rows.length;
    tableFilter();
    showEditedOnly();
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

    if (rows.length === 0 && canLoadAbilityFile()) {
      void loadAbilityData();
    }

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  });

  const pickFile = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: pickerDefaultPath(abilityPath(), preferredAbilityPath()),
      filters: [{ name: "DAT or YAML", extensions: ["dat", "yml", "yaml"] }],
    });

    if (typeof selected === "string") {
      setAbilityFile(selected);
    }
  };

  const parseEditableValueDraft = (key: AbilityEditableValueKey, value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    if (key === "new_charges_required" && parsed < 0) {
      return null;
    }

    return Math.trunc(parsed);
  };

  const setEditableValueDraft = (rowId: number, key: AbilityEditableValueKey, value: string) => {
    const current = editableValueDrafts.get(rowId) ?? {};
    current[key] = value;
    editableValueDrafts.set(rowId, current);
  };

  const editableValueDraftValue = (row: AbilityDiffRow, key: AbilityEditableValueKey) => {
    const draft = editableValueDrafts.get(row.row)?.[key];
    if (typeof draft === "string") {
      return draft;
    }
    return row[key] ?? "";
  };

  const commitEditableValueDraft = (rowId: number, key: AbilityEditableValueKey) => {
    const draft = editableValueDrafts.get(rowId)?.[key];
    if (typeof draft !== "string") {
      return;
    }

    const parsed = parseEditableValueDraft(key, draft);
    if (parsed === null) {
      return;
    }

    const rowIndex = rowIndexById().get(rowId);
    if (rowIndex === undefined) {
      return;
    }

    setRows(rowIndex, key, parsed);
  };

  const commitAllEditableValueDrafts = () => {
    for (const [rowId, drafts] of editableValueDrafts.entries()) {
      for (const key of Object.keys(drafts) as AbilityEditableValueKey[]) {
        commitEditableValueDraft(rowId, key);
      }
    }
  };

  const nameDraftValue = (row: AbilityDiffRow, key: "new_name" | "new_name_jp") => {
    const draft = nameDrafts.get(row.row)?.[key];
    if (typeof draft === "string") {
      return draft;
    }
    return row[key] ?? "";
  };

  const setNameDraft = (rowId: number, key: "new_name" | "new_name_jp", value: string) => {
    const current = nameDrafts.get(rowId) ?? {};
    current[key] = value;
    nameDrafts.set(rowId, current);
  };

  const commitNameDraft = (rowId: number, key: "new_name" | "new_name_jp") => {
    const draft = nameDrafts.get(rowId)?.[key];
    if (typeof draft !== "string") {
      return;
    }

    setRowNewString(rowId, key, draft);
  };

  const commitAllNameDrafts = () => {
    for (const [rowId, drafts] of nameDrafts.entries()) {
      for (const key of Object.keys(drafts) as Array<"new_name" | "new_name_jp">) {
        commitNameDraft(rowId, key);
      }
    }
  };

  const setRowNewString = (
    rowId: number,
    key:
      | "new_name"
      | "new_name_jp"
      | "new_description_en"
      | "new_description_jp"
      | "new_range"
      | "new_aoe_range"
      | "new_area_shape"
      | "new_valid_target_type",
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

  const toggleRowNewValidTarget = (row: AbilityDiffRow, target: string, enabled: boolean) => {
    const currentValues = normalizeStringList(row.new_valid_targets ?? row.old_valid_targets);
    const nextValues = enabled
      ? [...currentValues, target]
      : currentValues.filter((value) => value !== target);
    setRowNewValidTargets(row.row, nextValues);
  };

  const descriptionDraftValue = (row: AbilityDiffRow, key: "new_description_en" | "new_description_jp") => {
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

  const resetAllRowsToOriginal = async () => {
    const confirmed = await showConfirm(
      "Are you sure you want to reset ALL loaded Ability Changes? This cannot be reversed.",
      {
        title: "Reset All Ability Changes",
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
      new_id: row.old_id,
      new_name: row.old_name,
      new_name_jp: row.old_name_jp,
      new_description_en: row.old_description_en,
      new_description_jp: row.old_description_jp,
      new_valid_targets: row.old_valid_targets,
      new_charges_required: row.old_charges_required,
      new_range: row.old_range,
      new_aoe_range: row.old_aoe_range,
      new_area_shape: row.old_area_shape,
      new_valid_target_type: row.old_valid_target_type,
    }));

    batch(() => {
      nameDrafts.clear();
      descriptionDrafts.clear();
      editableValueDrafts.clear();
      setRows(() => resetRows);
      setLastNotice(`Reset ${resetRows.length} ability rows to original values.`);
      setRowsVersion((version) => version + 1);
    });
  };

  const saveEdited = async () => {
    if (rows.length === 0) {
      await showMessage("Load the ability file first.", { title: "Save Blocked", kind: "warning" });
      return;
    }
    if (!pathIsWithinRoot(abilityPath(), getOutputRoot(getProjectFolder()))) {
      await showMessage("The Ability Editor only saves from Custom. Click Make Base Ability DAT first, then use the Custom copy.", {
        title: "Project Copy Required",
        kind: "warning",
      });
      return;
    }

    const autoPaths = buildAutoSavePaths(abilityPath(), getProjectFolder());
    if (!autoPaths) {
      await showMessage(
        "Set Project Folder and use files under a ROM path (for example ROM/118/114.DAT) so save can be auto-routed.",
        { title: "Project Folder Required", kind: "warning" },
      );
      return;
    }

    const outYamlPath = autoPaths.yamlPath;
    const outDatPath: string | null = autoPaths.datPath;

    commitAllNameDrafts();
    commitAllEditableValueDrafts();
    const payloadRows = rows.map((row) => ({ ...rowWithDrafts(row), choice: "New" as const }));

    setSaving(true);
    try {
      const result = unwrap(await saveAbilityDiff(abilityPath(), abilityPath(), payloadRows, outYamlPath, outDatPath));
      const savedYamlPath = projectDisplayPath(result.out_yaml_path, getProjectFolder());
      const savedDatPath = projectDisplayPath(result.out_dat_path, getProjectFolder());
      const abilityNamesEnPath = projectDisplayPath(result.ability_names_en_path, getProjectFolder());
      const abilityNamesJpPath = projectDisplayPath(result.ability_names_jp_path, getProjectFolder());
      const abilityDescriptionsEnPath = projectDisplayPath(result.ability_descriptions_en_path, getProjectFolder());
      const abilityDescriptionsJpPath = projectDisplayPath(result.ability_descriptions_jp_path, getProjectFolder());
      setLastSavedYamlPath(savedYamlPath);
      setLastSavedDatPath(savedDatPath);
      if (result.out_dat_path) {
        setAbilityPath(result.out_dat_path);
      }
      setLastNotice(`Saved ${result.written_count} ability entries.`);
      await showMessage(
        `Saved ${result.written_count} ability entries.\nData YAML: ${savedYamlPath}${savedDatPath ? `\nData DAT: ${savedDatPath}` : ""}${abilityNamesEnPath ? `\nNames EN DAT: ${abilityNamesEnPath}` : ""}${abilityNamesJpPath ? `\nNames JP DAT: ${abilityNamesJpPath}` : ""}${abilityDescriptionsEnPath ? `\nDescriptions EN DAT: ${abilityDescriptionsEnPath}` : ""}${abilityDescriptionsJpPath ? `\nDescriptions JP DAT: ${abilityDescriptionsJpPath}` : ""}`,
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
        <h1 class="m-0">Ability Editor</h1>
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
              This editor uses a copied Ability DAT in the Project Folder so Kraken never edits your retail FFXI files directly.
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                class={`${compactButtonClass()} ${abilityBaseDatMade() ? "opacity-60 cursor-not-allowed" : ""}`}
                disabled={isLoading() || isSaving() || isMakingBaseDat() || isUpdatingBaseDat() || !getProjectFolder() || !!abilityBaseDatMade()}
                onclick={makeBaseAbilityDat}
              >
                {isMakingBaseDat() ? "Making Base Ability DAT..." : abilityBaseDatMade() ? "Base Ability DAT Made" : "Make Base Ability DAT"}
              </button>
              <Show when={abilityBaseDatMade()}>
                <button
                  class={compactButtonClass()}
                  disabled={isLoading() || isSaving() || isMakingBaseDat() || isUpdatingBaseDat() || !getProjectFolder()}
                  onclick={updateBaseAbilityDatFromSource}
                >
                  {isUpdatingBaseDat() ? "Updating Base..." : "Update Base From FFXI Source"}
                </button>
              </Show>
            </div>
          </div>

          <div class="min-w-0 flex items-center gap-2">
            <button class={compactButtonClass()} disabled={!getProjectFolder()} onclick={pickFile}>Custom Ability DAT/YAML</button>
            <span class="font-mono text-xs truncate" title={abilityPath() || "Not selected"}>
              {abilityDisplayPath() || "Not selected"}
            </span>
          </div>

          <div class="text-[11px] text-slate-400">
            {pathStatusText()}
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class={compactButtonClass()} disabled={isLoading() || isSaving() || isMakingBaseDat() || isUpdatingBaseDat() || !canLoadAbilityFile()} onclick={loadAbilityData}>
              {isLoading() ? "Reloading..." : "Reload"}
            </button>

            <button class={compactButtonClass()} disabled={isSaving() || rows.length === 0} onclick={saveEdited}>
              {isSaving() ? "Saving..." : "Save"}
            </button>

            <Show when={rows.length > 0}>
              <input
                class="m-0 min-w-[12rem] flex-1 md:flex-none md:w-64 py-0.5 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                name="ability-editor-search"
                autocomplete="off"
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
            </div>
          </Show>

          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
            <Show when={rows.length > 0}>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class={compactButtonClass(showEditedOnly())}
                  disabled={editedRowIds().size === 0}
                  onClick={() => {
                    setShowEditedOnly((value) => !value);
                    refreshRowMetrics();
                  }}
                >
                  {showEditedOnly() ? "Show All Rows" : "Edited Only"}
                </button>
                <span class="text-slate-300">
                  Showing: {displayedRows().length} / {rows.length}
                </span>
              </div>
            </Show>
            <Show when={rows.length > 0}>
              <div class="flex flex-col items-end gap-1">
                <div class="text-slate-300">
                  Edited: {editedRowIds().size}
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    class={compactButtonClass()}
                    disabled={isLoading() || isSaving() || isMakingBaseDat() || isUpdatingBaseDat() || isResettingToRetailBase() || !abilityBaseDatMade()}
                    onClick={() => {
                      void resetAbilityDatToRetailBaseCopy();
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
                </tr>
              </thead>
              <tbody>
                <Show when={virtualWindow().topPadding > 0}>
                  <tr>
                    <td colSpan={abilityEditorColumnCount()} style={{ height: `${virtualWindow().topPadding}px`, padding: "0", border: "0" }}></td>
                  </tr>
                </Show>

                <For each={visibleRows()}>
                  {(row) => {
                    return (
                    <tr>
                      {(() => {
                        const displayRow = rowWithDrafts(row);
                        const rowMetrics = virtualLayout().metricsByRow.get(row.row) ?? DEFAULT_ROW_METRICS;
                        const currentValidTargets = normalizeStringList(row.new_valid_targets ?? row.old_valid_targets);
                        const namesChanged =
                          (displayRow.old_name ?? null) !== (displayRow.new_name ?? null) ||
                          (displayRow.old_name_jp ?? null) !== (displayRow.new_name_jp ?? null);
                        const editableValuesChanged =
                          (displayRow.old_charges_required ?? null) !== (displayRow.new_charges_required ?? null) ||
                          (displayRow.old_range ?? null) !== (displayRow.new_range ?? null) ||
                          (displayRow.old_aoe_range ?? null) !== (displayRow.new_aoe_range ?? null) ||
                          (displayRow.old_area_shape ?? null) !== (displayRow.new_area_shape ?? null) ||
                          (displayRow.old_valid_target_type ?? null) !== (displayRow.new_valid_target_type ?? null);
                        const validTargetsChanged = !stringListsEqual(row.old_valid_targets, row.new_valid_targets);
                        const descriptionEnChanged = (displayRow.old_description_en ?? null) !== (displayRow.new_description_en ?? null);
                        const descriptionJpChanged = (displayRow.old_description_jp ?? null) !== (displayRow.new_description_jp ?? null);
                        return (
                          <>
                      <td class={`font-mono truncate ${rowIsEdited(row) ? ROW_CHANGED_MARKER_CLASS : "border-l-2 border-transparent"}`}>{row.new_id ?? row.old_id ?? "-"}</td>
                      <Show when={showNamesColumn()}>
                        <td class="relative min-w-0">
                          <Show when={namesChanged}>
                            <span class={CHANGE_DOT_CLASS}></span>
                          </Show>
                          <div class="flex min-w-0 flex-col gap-1">
                            <input
                              class="m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                              type="text"
                              name={`ability-name-en-${row.row}`}
                              autocomplete="off"
                              ref={(el) => {
                                el.value = nameDraftValue(row, "new_name");
                              }}
                              placeholder="EN"
                              title={row.new_name ?? row.old_name ?? ""}
                              onInput={(e) => setNameDraft(row.row, "new_name", e.currentTarget.value)}
                              onBlur={() => commitNameDraft(row.row, "new_name")}
                            />
                            <input
                              class="m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                              type="text"
                              name={`ability-name-jp-${row.row}`}
                              autocomplete="off"
                              ref={(el) => {
                                el.value = nameDraftValue(row, "new_name_jp");
                              }}
                              placeholder="JP"
                              title={row.new_name_jp ?? row.old_name_jp ?? ""}
                              onInput={(e) => setNameDraft(row.row, "new_name_jp", e.currentTarget.value)}
                              onBlur={() => commitNameDraft(row.row, "new_name_jp")}
                            />
                          </div>
                        </td>
                      </Show>
                      <Show when={showTimingColumns()}>
                        <td class="relative">
                          <Show when={editableValuesChanged}>
                            <span class={CHANGE_DOT_CLASS}></span>
                          </Show>
                          <div class="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1 rounded-md border border-slate-500 px-2 py-1">
                            <div class="flex min-w-0 flex-col gap-1">
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Charges</span>
                                <input
                                  class={COMPACT_VALUE_INPUT_CLASS}
                                  type="number"
                                  name={`ability-charges-${row.row}`}
                                  autocomplete="off"
                                  min={0}
                                  step={1}
                                  ref={(el) => {
                                    el.value = `${editableValueDraftValue(row, "new_charges_required")}`;
                                  }}
                                  onInput={(e) => setEditableValueDraft(row.row, "new_charges_required", e.currentTarget.value)}
                                  onBlur={() => commitEditableValueDraft(row.row, "new_charges_required")}
                                />
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Range</span>
                                <select
                                  class={COMPACT_VALUE_SELECT_CLASS}
                                  name={`ability-range-${row.row}`}
                                  autocomplete="off"
                                  value={row.new_range ?? ""}
                                  onChange={(e) => setRowNewString(row.row, "new_range", e.currentTarget.value)}
                                >
                                  <For each={SPELL_DISTANCE_OPTIONS}>
                                    {(option) => <option value={option}>{option}</option>}
                                  </For>
                                </select>
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>AoE Rng</span>
                                <select
                                  class={COMPACT_VALUE_SELECT_CLASS}
                                  name={`ability-aoe-range-${row.row}`}
                                  autocomplete="off"
                                  value={row.new_aoe_range ?? ""}
                                  onChange={(e) => setRowNewString(row.row, "new_aoe_range", e.currentTarget.value)}
                                >
                                  <For each={SPELL_DISTANCE_OPTIONS}>
                                    {(option) => <option value={option}>{option}</option>}
                                  </For>
                                </select>
                              </label>
                            </div>
                            <div class="flex min-w-0 flex-col gap-1">
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Shape</span>
                                <select
                                  class={COMPACT_VALUE_SELECT_CLASS}
                                  name={`ability-area-shape-${row.row}`}
                                  autocomplete="off"
                                  value={row.new_area_shape ?? ""}
                                  onChange={(e) => setRowNewString(row.row, "new_area_shape", e.currentTarget.value)}
                                >
                                  <For each={AREA_SHAPE_OPTIONS}>
                                    {(option) => <option value={option}>{option}</option>}
                                  </For>
                                </select>
                              </label>
                              <label class={COMPACT_VALUE_FIELD_CLASS}>
                                <span>Target</span>
                                <select
                                  class={COMPACT_VALUE_SELECT_CLASS}
                                  name={`ability-valid-target-type-${row.row}`}
                                  autocomplete="off"
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
                        <td class="relative">
                          <Show when={validTargetsChanged}>
                            <span class={CHANGE_DOT_CLASS}></span>
                          </Show>
                          <div
                            class="grid grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(4.75rem,1.2fr)] gap-x-0.5 gap-y-0.5 overflow-hidden rounded-md border border-slate-500 px-1 py-1 text-[11px] leading-4"
                            style={{ height: `${rowMetrics.validTargetsHeight}px` }}
                          >
                            <For each={validTargetOptionsForValues(row.old_valid_targets, row.new_valid_targets)}>
                              {(target) => (
                                <label class="m-0 flex min-w-0 items-center gap-0.5 font-normal normal-case text-slate-100" title={target}>
                                  <input
                                    class="!m-0 !h-3 !w-3 shrink-0"
                                    type="checkbox"
                                    name={`ability-valid-target-${row.row}-${target}`}
                                    autocomplete="off"
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
                        <td class="relative">
                          <Show when={descriptionEnChanged}>
                            <span class={CHANGE_DOT_CLASS}></span>
                          </Show>
                          <textarea
                            class="m-0 w-full overflow-hidden py-0.5 px-2 text-sm leading-5 resize-none rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                            name={`ability-description-en-${row.row}`}
                            autocomplete="off"
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
                        <td class="relative">
                          <Show when={descriptionJpChanged}>
                            <span class={CHANGE_DOT_CLASS}></span>
                          </Show>
                          <textarea
                            class="m-0 w-full overflow-hidden py-0.5 px-2 text-sm leading-5 resize-none rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                            name={`ability-description-jp-${row.row}`}
                            autocomplete="off"
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
                          </>
                        );
                      })()}
                    </tr>
                    );
                  }}
                </For>

                <Show when={virtualWindow().bottomPadding > 0}>
                  <tr>
                    <td colSpan={abilityEditorColumnCount()} style={{ height: `${virtualWindow().bottomPadding}px`, padding: "0", border: "0" }}></td>
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

export default AbilityDiffTool;
