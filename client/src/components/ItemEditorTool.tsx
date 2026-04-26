import { useSearchParams } from "@solidjs/router";
import { For, Show, batch, createDeferred, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { commands, DatDescriptor, DatDescriptorInfo } from "../bindings";
import { ItemEditorRow, ItemEditorSaveTarget, areAllItemDatsMadeInProject, copyItemDatsToProject, loadItemEditorData, resetItemEditorDataToRetailBase, saveItemEditorData } from "../custom_bindings";
import { showConfirm, showMessage } from "../dialogs";
import { useData } from "../store";
import { projectDisplayPath, unwrap } from "../util";

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

function isChangedRow(row: ItemEditorRow) {
  return (
    row.old_id !== row.new_id ||
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
    row.old_weapon_damage !== row.new_weapon_damage ||
    row.old_weapon_delay !== row.new_weapon_delay ||
    row.old_weapon_dps !== row.new_weapon_dps ||
    (row.old_weapon_skill_type ?? null) !== (row.new_weapon_skill_type ?? null) ||
    row.old_weapon_jug_size !== row.new_weapon_jug_size ||
    row.old_weapon_emote !== row.new_weapon_emote ||
    (row.old_icon_bytes ?? null) !== (row.new_icon_bytes ?? null) ||
    !arraysEqual(row.old_flags, row.new_flags) ||
    !arraysEqual(row.old_jobs, row.new_jobs) ||
    (row.old_en_name ?? null) !== (row.new_en_name ?? null) ||
    (row.old_en_article_type ?? null) !== (row.new_en_article_type ?? null) ||
    (row.old_en_singular_name ?? null) !== (row.new_en_singular_name ?? null) ||
    (row.old_en_plural_name ?? null) !== (row.new_en_plural_name ?? null) ||
    (row.old_en_description ?? null) !== (row.new_en_description ?? null) ||
    (row.old_jp_name ?? null) !== (row.new_jp_name ?? null) ||
    (row.old_jp_description ?? null) !== (row.new_jp_description ?? null)
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

function replaceExt(fileName: string, newExt: string): string {
  const idx = fileName.lastIndexOf(".");
  const base = idx > 0 ? fileName.slice(0, idx) : fileName;
  return `${base}${newExt}`;
}

function normalizePath(path: string) {
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

function pathIsWithinRoot(path: string, root: string | null) {
  if (!path || !root) {
    return false;
  }

  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

const compactButtonBaseClass = "my-0 px-1.5 py-0.5 text-xs font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
const compactButtonActiveClass = "bg-green-800 border-green-500 text-slate-100";
const ITEM_EDITOR_STATE_KEY = "xi_tinkerer_item_editor_state_v1";
const ITEM_EDITOR_COLUMN_COUNT = 2;
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
const IN_GAME_JOB_ORDER = [
  "WAR",
  "MNK",
  "WHM",
  "BLM",
  "RDM",
  "THF",
  "PLD",
  "DRK",
  "BST",
  "BRD",
  "RNG",
  "SAM",
  "NIN",
  "DRG",
  "SMN",
  "BLU",
  "COR",
  "PUP",
  "DNC",
  "SCH",
  "GEO",
  "RUN",
];
const IN_GAME_JOB_ORDER_INDEX = new Map(IN_GAME_JOB_ORDER.map((job, index) => [job, index]));
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
const WEAPON_SKILL_TYPE_OPTIONS = [
  "None",
  "HandToHand",
  "Dagger",
  "Sword",
  "GreatSword",
  "Axe",
  "GreatAxe",
  "Scythe",
  "PoleArm",
  "Katana",
  "GreatKatana",
  "Club",
  "Staff",
  "AutomatonMelee",
  "AutomatonRange",
  "AutomatonMagic",
  "Ranged",
  "Marksmanship",
  "Thrown",
  "DivineMagic",
  "HealingMagic",
  "EnhancingMagic",
  "EnfeeblingMagic",
  "ElementalMagic",
  "DarkMagic",
  "SummoningMagic",
  "Ninjutsu",
  "Singing",
  "StringInstrument",
  "WindInstrument",
  "BlueMagic",
  "Geomancy",
  "Handbell",
  "Fishing",
  "Woodworking",
  "Smithing",
  "Goldsmithing",
  "Clothcraft",
  "Leathercraft",
  "Bonecraft",
  "Alchemy",
  "Cooking",
  "Special",
];

interface ItemEditorCachedState {
  english_source_path: string;
  japanese_source_path: string;
  selected_dat_type?: string;
  rows?: ItemEditorRow[];
  table_filter: string;
  show_edited_only: boolean;
  left_panel_collapsed?: boolean;
  flags_section_collapsed?: boolean;
  jobs_section_collapsed?: boolean;
  english_text_section_collapsed?: boolean;
  japanese_text_section_collapsed?: boolean;
  selected_row: number | null;
  last_notice: string;
  last_saved_english_yaml_path: string;
  last_saved_english_dat_path: string;
  last_saved_japanese_yaml_path: string;
  last_saved_japanese_dat_path: string;
}

function compactButtonClass(active = false) {
  return `${compactButtonBaseClass} ${active ? compactButtonActiveClass : compactButtonIdleClass}`;
}

function rowSearchText(row: ItemEditorRow) {
  return [
    row.row,
    row.old_id,
    row.old_stack_size,
    row.new_id,
    row.new_stack_size,
    row.old_level,
    row.new_level,
    row.old_item_type,
    row.new_item_type,
    row.old_shield_size,
    row.new_shield_size,
    row.old_max_charges,
    row.new_max_charges,
    row.old_casting_time,
    row.new_casting_time,
    row.old_use_delay,
    row.new_use_delay,
    row.old_reuse_delay,
    row.new_reuse_delay,
    row.old_en_name,
    row.new_en_name,
    row.old_en_article_type,
    row.new_en_article_type,
    row.old_en_singular_name,
    row.new_en_singular_name,
    row.old_en_plural_name,
    row.new_en_plural_name,
    row.old_en_description,
    row.new_en_description,
    row.old_jp_name,
    row.new_jp_name,
    row.old_jp_description,
    row.new_jp_description,
    ...(row.old_flags ?? []),
    ...(row.new_flags ?? []),
    ...(row.old_jobs ?? []),
    ...(row.new_jobs ?? []),
    ...(row.old_valid_targets ?? []),
    ...(row.new_valid_targets ?? []),
    ...(row.old_slots ?? []),
    ...(row.new_slots ?? []),
    row.old_weapon_damage,
    row.new_weapon_damage,
    row.old_weapon_delay,
    row.new_weapon_delay,
    row.old_weapon_dps,
    row.new_weapon_dps,
    row.old_weapon_skill_type,
    row.new_weapon_skill_type,
    row.old_weapon_jug_size,
    row.new_weapon_jug_size,
    row.old_weapon_emote,
    row.new_weapon_emote,
    row.old_icon_bytes,
    row.new_icon_bytes,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => `${value}`.toLowerCase())
    .join(" ");
}

function normalizedStringList(values: string[] | null | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0))).sort();
}

function inGameSortedJobs(values: string[] | null | undefined): string[] {
  return normalizedStringList(values).sort((left, right) => {
    const leftIndex = IN_GAME_JOB_ORDER_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = IN_GAME_JOB_ORDER_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
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
  const normalized = normalizedStringList(values);
  return JSON.stringify(normalized);
}

function slotPresetKey(values: string[] | null | undefined) {
  const normalized = normalizedStringList(values);
  return JSON.stringify(normalized);
}

function calculateWeaponDps(damage: number | null | undefined, delay: number | null | undefined) {
  if (damage === null || damage === undefined || delay === null || delay === undefined || delay <= 0) {
    return null;
  }
  return Math.floor((damage * 6000) / delay);
}

function normalizeBase64(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "");
}

function decodeBase64Bytes(value: string | null | undefined): Uint8Array | null {
  const normalized = normalizeBase64(value);
  if (!normalized) {
    return null;
  }

  try {
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = window.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function readLe16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readLe32(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function iconBytesToDataUrl(iconBytes: string | null | undefined): string | null {
  const bytes = decodeBase64Bytes(iconBytes);
  if (!bytes || bytes.length < 57 || bytes[0] !== 0x91) {
    return null;
  }

  const headerOffset = 17;
  const bitmapInfoLength = readLe32(bytes, headerOffset);
  if (bitmapInfoLength !== 40) {
    return null;
  }

  const width = readLe32(bytes, headerOffset + 4);
  const height = readLe32(bytes, headerOffset + 8);
  const planes = readLe16(bytes, headerOffset + 12);
  const bitCount = readLe16(bytes, headerOffset + 14);
  const compression = readLe32(bytes, headerOffset + 16);
  if (width !== 32 || height !== 32 || planes !== 1 || bitCount !== 8 || compression !== 0) {
    return null;
  }

  const paletteOffset = headerOffset + bitmapInfoLength;
  const pixelCount = width * height;
  const pixelOffset = bytes.length - pixelCount;
  if (pixelOffset <= paletteOffset || pixelOffset + pixelCount > bytes.length) {
    return null;
  }

  const paletteEntryCount = Math.floor((pixelOffset - paletteOffset) / 4);
  if (paletteEntryCount <= 0) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const imageData = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = bytes[pixelOffset + sourceY * width + x];
      const paletteIndex = Math.min(pixelIndex, paletteEntryCount - 1);
      const paletteOffsetForIndex = paletteOffset + paletteIndex * 4;
      const outputOffset = (y * width + x) * 4;
      imageData.data[outputOffset] = bytes[paletteOffsetForIndex + 2];
      imageData.data[outputOffset + 1] = bytes[paletteOffsetForIndex + 1];
      imageData.data[outputOffset + 2] = bytes[paletteOffsetForIndex];
      const alpha = bytes[paletteOffsetForIndex + 3];
      imageData.data[outputOffset + 3] = alpha === 0 ? 0 : Math.min(255, alpha * 2);
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function buildRowIndexById(rows: ItemEditorRow[]) {
  const indexById = new Map<number, number>();
  rows.forEach((row, index) => {
    indexById.set(row.row, index);
  });
  return indexById;
}

function buildEditedRowIdSet(rows: ItemEditorRow[]) {
  return new Set(rows.filter((row) => isChangedRow(row)).map((row) => row.row));
}

function loadCachedState(): ItemEditorCachedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(ITEM_EDITOR_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as ItemEditorCachedState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function ItemEditorTool() {
  const {
    folders: { getProjectFolder },
  } = useData();
  const [searchParams] = useSearchParams();
  const cachedState = loadCachedState();

  const [itemPath, setItemPath] = createSignal(cachedState?.english_source_path ?? "");
  const [japaneseItemPath, setJapaneseItemPath] = createSignal(cachedState?.japanese_source_path ?? "");
  const [selectedDatType, setSelectedDatType] = createSignal(cachedState?.selected_dat_type ?? "");
  const [rows, setRows] = createStore<ItemEditorRow[]>(cachedState?.rows ?? []);
  const [rowIndexById, setRowIndexById] = createSignal<Map<number, number>>(buildRowIndexById(cachedState?.rows ?? []));
  const [tableFilter, setTableFilter] = createSignal(cachedState?.table_filter ?? "");
  const deferredTableFilter = createDeferred(() => tableFilter());
  const [showEditedOnly, setShowEditedOnly] = createSignal(cachedState?.show_edited_only ?? false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = createSignal(cachedState?.left_panel_collapsed ?? false);
  const [flagsSectionCollapsed, setFlagsSectionCollapsed] = createSignal(cachedState?.flags_section_collapsed ?? false);
  const [jobsSectionCollapsed, setJobsSectionCollapsed] = createSignal(cachedState?.jobs_section_collapsed ?? false);
  const [englishTextSectionCollapsed, setEnglishTextSectionCollapsed] = createSignal(cachedState?.english_text_section_collapsed ?? false);
  const [japaneseTextSectionCollapsed, setJapaneseTextSectionCollapsed] = createSignal(cachedState?.japanese_text_section_collapsed ?? false);
  const [selectedRowId, setSelectedRowId] = createSignal<number | null>(cachedState?.selected_row ?? null);
  const [editedRowIds, setEditedRowIds] = createSignal<Set<number>>(buildEditedRowIdSet(cachedState?.rows ?? []));
  const [lastNotice, setLastNotice] = createSignal(cachedState?.last_notice ?? "");
  const [lastSavedYamlPath, setLastSavedYamlPath] = createSignal(cachedState?.last_saved_english_yaml_path ?? "");
  const [lastSavedDatPath, setLastSavedDatPath] = createSignal(cachedState?.last_saved_english_dat_path ?? "");
  const [lastSavedJapaneseYamlPath, setLastSavedJapaneseYamlPath] = createSignal(cachedState?.last_saved_japanese_yaml_path ?? "");
  const [lastSavedJapaneseDatPath, setLastSavedJapaneseDatPath] = createSignal(cachedState?.last_saved_japanese_dat_path ?? "");
  const [prefillApplied, setPrefillApplied] = createSignal(false);
  const [isLoading, setLoading] = createSignal(false);
  const [isSaving, setSaving] = createSignal(false);
  const [isResolvingDat, setResolvingDat] = createSignal(false);
  const [isMakingBaseDats, setMakingBaseDats] = createSignal(false);
  const [isResettingToRetailBase, setResettingToRetailBase] = createSignal(false);
  const [rowsVersion, setRowsVersion] = createSignal(0);

  const [scrollTop, setScrollTop] = createSignal(0);
  const [tableViewportHeight, setTableViewportHeight] = createSignal(480);

  const [itemDatOptions] = createResource(async () => unwrap(await commands.getItemDats()));
  const [allBaseDatsMade, { refetch: refetchAllBaseDatsMade }] = createResource(
    () => getProjectFolder(),
    async (projectFolder) => {
      if (!projectFolder) {
        return false;
      }
      return unwrap(await areAllItemDatsMadeInProject());
    },
  );
  const selectedDatDescriptor = createMemo(() => itemDatOptions()?.find((option) => option.descriptor.type === selectedDatType())?.descriptor ?? null);

  let tableContainerRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let persistStateTimer: number | undefined;

  const canLoadSelectedFile = createMemo(() =>
    !!selectedDatDescriptor() && !!getProjectFolder() && !!allBaseDatsMade()
  );
  const pathStatusText = createMemo(() => {
    if (!selectedDatDescriptor()) {
      return "Select an item DAT set to begin.";
    }
    if (!getProjectFolder()) {
      return "Set a Project Folder so Kraken can stage and save both EN and JP item DATs.";
    }
    if (!allBaseDatsMade()) {
      return "This editor only loads item DATs from the Project Folder. Click Make all Base DATs first so Kraken never edits against retail files.";
    }
    return "This editor loads item DATs only from the Project Folder as a paired EN/JP dataset and saves both outputs there.";
  });

  const displayedRows = createMemo(() => {
    const filterText = deferredTableFilter().trim().toLowerCase();
    const baseRows = showEditedOnly() ? rows.filter((row) => editedRowIds().has(row.row)) : rows;
    if (!filterText) {
      return baseRows;
    }

    return baseRows.filter((row) => rowSearchText(row).includes(filterText));
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

  const resetLoadedRows = () => {
    setRows([]);
    setRowIndexById(new Map());
    setEditedRowIds(new Set());
    setSelectedRowId(null);
    setRowsVersion((version) => version + 1);
  };

  const setItemSources = (englishPath: string, japanesePath = "") => {
    setItemPath(englishPath);
    setJapaneseItemPath(japanesePath);
    resetLoadedRows();
    setLastNotice("");
  };

  const chooseItemDat = async (option: DatDescriptorInfo) => {
    batch(() => {
      setSelectedDatType(option.descriptor.type);
      setItemSources("", "");
      setLastNotice(`Selected ${option.descriptor.type}${option.has_jp ? " (EN + JP)" : " (EN only)"}.`);
    });
    if (getProjectFolder() && allBaseDatsMade()) {
      await loadItemData(option.descriptor);
    }
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

  const loadItemData = async (descriptorOverride?: DatDescriptor) => {
    const descriptor = descriptorOverride ?? selectedDatDescriptor();
    if (!descriptor) {
      await showMessage("Select the item DAT set first.", { title: "Load Blocked", kind: "warning" });
      return;
    }
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken knows where to place the paired item outputs.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }
    if (!allBaseDatsMade()) {
      await showMessage("Make all Base DATs first. The Item Editor only loads DATs from the Project Folder so Kraken never edits your retail files.", {
        title: "Base DATs Required",
        kind: "warning",
      });
      return;
    }

    setLoading(true);
    try {
      const result = unwrap(await loadItemEditorData(descriptor));
      const preparedRows = result.rows.map((row) => ({
        ...row,
        new_valid_targets: normalizedStringList(row.new_valid_targets ?? row.old_valid_targets),
        new_slots: normalizedStringList(row.new_slots ?? row.old_slots),
        new_flags: normalizedStringList(row.new_flags ?? row.old_flags),
        new_jobs: normalizedStringList(row.new_jobs ?? row.old_jobs),
      }));
      batch(() => {
        setRows(() => preparedRows);
        setRowIndexById(buildRowIndexById(preparedRows));
        setEditedRowIds(buildEditedRowIdSet(preparedRows));
        setSelectedRowId(preparedRows[0]?.row ?? null);
        setItemPath(result.english_source_path);
        setJapaneseItemPath(result.japanese_source_path ?? "");
        setLastNotice(`Loaded ${preparedRows.length} item rows${result.japanese_source_path ? " with EN + JP text" : ""}.`);
        setRowsVersion((version) => version + 1);
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Load Error", kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  const makeAllBaseDats = async () => {
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken knows where to place the copied DATs.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }

    setMakingBaseDats(true);
    try {
      const copiedPaths = unwrap(await copyItemDatsToProject());
      await refetchAllBaseDatsMade();
      batch(() => {
        setLastNotice(`Copied ${copiedPaths.length} base item DATs into Project Folder.`);
      });
      await showMessage(`Copied ${copiedPaths.length} base item DATs into Project Folder.`, {
        title: "Base DATs Ready",
        kind: "info",
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Copy Error", kind: "error" });
    } finally {
      setMakingBaseDats(false);
    }
  };

  const resetItemDatToRetailBase = async () => {
    const descriptor = selectedDatDescriptor();
    if (!descriptor) {
      await showMessage("Select the item DAT set first.", { title: "Reset Blocked", kind: "warning" });
      return;
    }
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first.", { title: "Project Folder Required", kind: "warning" });
      return;
    }
    if (!allBaseDatsMade()) {
      await showMessage("Make all Base DATs first so Kraken has Retail Base files to restore from.", {
        title: "Base DATs Required",
        kind: "warning",
      });
      return;
    }

    const confirmed = await showConfirm(
      "Reset this item DAT set in Custom back to Retail Base? This overwrites the current Custom DAT copy.",
      {
        title: "Reset To Retail Base",
        kind: "warning",
        okLabel: "Reset DAT",
        cancelLabel: "Cancel",
      },
    );
    if (confirmed !== true) {
      return;
    }

    setResettingToRetailBase(true);
    try {
      const resetPaths = unwrap(await resetItemEditorDataToRetailBase(descriptor));
      await loadItemData(descriptor);
      setLastNotice(`Reset ${resetPaths.length} item DAT${resetPaths.length === 1 ? "" : "s"} to Retail Base.`);
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

    searchParams.edited;
    searchParams.path;
    setPrefillApplied(true);
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

    itemPath();
    japaneseItemPath();
    selectedDatType();
    rowsVersion();
    tableFilter();
    showEditedOnly();
    leftPanelCollapsed();
    flagsSectionCollapsed();
    jobsSectionCollapsed();
    englishTextSectionCollapsed();
    japaneseTextSectionCollapsed();
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
      const stateToSave: ItemEditorCachedState = {
        english_source_path: itemPath(),
        japanese_source_path: japaneseItemPath(),
        selected_dat_type: selectedDatType(),
        table_filter: tableFilter(),
        show_edited_only: showEditedOnly(),
        left_panel_collapsed: leftPanelCollapsed(),
        flags_section_collapsed: flagsSectionCollapsed(),
        jobs_section_collapsed: jobsSectionCollapsed(),
        english_text_section_collapsed: englishTextSectionCollapsed(),
        japanese_text_section_collapsed: japaneseTextSectionCollapsed(),
        selected_row: selectedRowId(),
        last_notice: lastNotice(),
        last_saved_english_yaml_path: lastSavedYamlPath(),
        last_saved_english_dat_path: lastSavedDatPath(),
        last_saved_japanese_yaml_path: lastSavedJapaneseYamlPath(),
        last_saved_japanese_dat_path: lastSavedJapaneseDatPath(),
      };

      try {
        window.sessionStorage.setItem(ITEM_EDITOR_STATE_KEY, JSON.stringify(stateToSave));
      } catch (error) {
        console.warn("Failed to persist item editor UI state.", error);
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

    if (rows.length === 0 && selectedDatDescriptor()) {
      void loadItemData();
    }

    return () => {
      if (scrollFrame !== 0) {
        window.cancelAnimationFrame(scrollFrame);
      }
      window.removeEventListener("resize", handleResize);
    };
  });

  const updateRowById = (rowId: number, updater: (row: ItemEditorRow) => void) => {
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
      setEditedRowIds((current) => {
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
    });
  };

  const setRowNewEnglishName = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_en_name = value;
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
    });
  };

  const setRowNewLevel = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_level = nextValue;
    });
  };

  const setRowNewItemType = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_item_type = value;
    });
  };

  const setRowNewShieldSize = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_shield_size = nextValue;
    });
  };

  const setRowNewMaxCharges = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_max_charges = nextValue;
    });
  };

  const setRowNewCastingTime = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_casting_time = nextValue;
    });
  };

  const setRowNewUseDelay = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_use_delay = nextValue;
    });
  };

  const setRowNewReuseDelay = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_reuse_delay = nextValue;
    });
  };

  const setRowNewValidTargets = (rowId: number, values: string[]) => {
    updateRowById(rowId, (row) => {
      row.new_valid_targets = normalizedStringList(values);
    });
  };

  const setRowNewSlots = (rowId: number, values: string[]) => {
    updateRowById(rowId, (row) => {
      row.new_slots = normalizedStringList(values);
    });
  };

  const setRowNewWeaponDamage = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_weapon_damage = nextValue;
      row.new_weapon_dps = calculateWeaponDps(nextValue, row.new_weapon_delay ?? row.old_weapon_delay);
    });
  };

  const setRowNewWeaponDelay = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_weapon_delay = nextValue;
      row.new_weapon_dps = calculateWeaponDps(row.new_weapon_damage ?? row.old_weapon_damage, nextValue);
    });
  };

  const setRowNewWeaponSkillType = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_weapon_skill_type = value;
    });
  };

  const setRowNewWeaponJugSize = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_weapon_jug_size = nextValue;
    });
  };

  const setRowNewWeaponEmote = (rowId: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
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
      row.new_weapon_emote = nextValue;
    });
  };

  const setRowNewIconBytes = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_icon_bytes = normalizeBase64(value);
    });
  };

  const setRowNewFlags = (rowId: number, flags: string[]) => {
    const nextFlags = normalizedStringList(flags);
    updateRowById(rowId, (row) => {
      row.new_flags = nextFlags;
    });
  };

  const setRowNewJobs = (rowId: number, jobs: string[]) => {
    const nextJobs = normalizedStringList(jobs);
    updateRowById(rowId, (row) => {
      row.new_jobs = nextJobs;
    });
  };

  const setRowNewEnglishArticleType = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_en_article_type = value;
    });
  };

  const setRowNewEnglishSingularName = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_en_singular_name = value;
    });
  };

  const setRowNewEnglishPluralName = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_en_plural_name = value;
    });
  };

  const setRowNewEnglishDescription = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_en_description = value;
    });
  };

  const setRowNewJapaneseName = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_jp_name = value;
    });
  };

  const setRowNewJapaneseDescription = (rowId: number, value: string) => {
    updateRowById(rowId, (row) => {
      row.new_jp_description = value;
    });
  };

  const resetRowToOriginal = (rowId: number) => {
    updateRowById(rowId, (row) => {
      row.new_id = row.old_id;
      row.new_stack_size = row.old_stack_size;
      row.new_level = row.old_level;
      row.new_item_type = row.old_item_type;
      row.new_shield_size = row.old_shield_size;
      row.new_max_charges = row.old_max_charges;
      row.new_casting_time = row.old_casting_time;
      row.new_use_delay = row.old_use_delay;
      row.new_reuse_delay = row.old_reuse_delay;
      row.new_valid_targets = normalizedStringList(row.old_valid_targets);
      row.new_slots = normalizedStringList(row.old_slots);
      row.new_weapon_damage = row.old_weapon_damage;
      row.new_weapon_delay = row.old_weapon_delay;
      row.new_weapon_dps = row.old_weapon_dps;
      row.new_weapon_skill_type = row.old_weapon_skill_type;
      row.new_weapon_jug_size = row.old_weapon_jug_size;
      row.new_weapon_emote = row.old_weapon_emote;
      row.new_icon_bytes = row.old_icon_bytes;
      row.new_flags = normalizedStringList(row.old_flags);
      row.new_jobs = normalizedStringList(row.old_jobs);
      row.new_en_name = row.old_en_name;
      row.new_en_article_type = row.old_en_article_type;
      row.new_en_singular_name = row.old_en_singular_name;
      row.new_en_plural_name = row.old_en_plural_name;
      row.new_en_description = row.old_en_description ?? null;
      row.new_jp_name = row.old_jp_name;
      row.new_jp_description = row.old_jp_description ?? null;
    });
  };

  const resetAllRowsToOriginal = async () => {
    const confirmed = await showConfirm(
      "Are you sure you want to reset ALL loaded item changes for this DAT? This cannot be reversed.",
      {
        title: "Reset All Item Changes",
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
      new_stack_size: row.old_stack_size,
      new_level: row.old_level,
      new_item_type: row.old_item_type,
      new_shield_size: row.old_shield_size,
      new_max_charges: row.old_max_charges,
      new_casting_time: row.old_casting_time,
      new_use_delay: row.old_use_delay,
      new_reuse_delay: row.old_reuse_delay,
      new_valid_targets: normalizedStringList(row.old_valid_targets),
      new_slots: normalizedStringList(row.old_slots),
      new_weapon_damage: row.old_weapon_damage,
      new_weapon_delay: row.old_weapon_delay,
      new_weapon_dps: row.old_weapon_dps,
      new_weapon_skill_type: row.old_weapon_skill_type,
      new_weapon_jug_size: row.old_weapon_jug_size,
      new_weapon_emote: row.old_weapon_emote,
      new_icon_bytes: row.old_icon_bytes,
      new_flags: normalizedStringList(row.old_flags),
      new_jobs: normalizedStringList(row.old_jobs),
      new_en_name: row.old_en_name,
      new_en_article_type: row.old_en_article_type,
      new_en_singular_name: row.old_en_singular_name,
      new_en_plural_name: row.old_en_plural_name,
      new_en_description: row.old_en_description ?? null,
      new_jp_name: row.old_jp_name,
      new_jp_description: row.old_jp_description ?? null,
    }));

    batch(() => {
      setRows(() => resetRows);
      setEditedRowIds(new Set());
      setLastNotice(`Reset ${resetRows.length} item rows to original values.`);
      setRowsVersion((version) => version + 1);
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

  const saveEdited = async (saveTarget: ItemEditorSaveTarget) => {
    if (rows.length === 0) {
      await showMessage("Load the item file first.", { title: "Save Blocked", kind: "warning" });
      return;
    }
    const descriptor = selectedDatDescriptor();
    if (!descriptor) {
      await showMessage("Select the item DAT set first.", { title: "Save Blocked", kind: "warning" });
      return;
    }
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken can save item DATs.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }
    if (saveTarget === "japanese" && !japaneseItemPath()) {
      await showMessage("This item DAT does not have a Japanese pair to save.", {
        title: "Save Blocked",
        kind: "warning",
      });
      return;
    }

    setSaving(true);
    try {
      const result = unwrap(await saveItemEditorData(descriptor, rows.map((row) => ({ ...row })), saveTarget));
      const englishYamlPath = projectDisplayPath(result.english_out_yaml_path, getProjectFolder());
      const englishDatPath = projectDisplayPath(result.english_out_dat_path, getProjectFolder());
      const japaneseYamlPath = projectDisplayPath(result.japanese_out_yaml_path, getProjectFolder());
      const japaneseDatPath = projectDisplayPath(result.japanese_out_dat_path, getProjectFolder());
      if (result.saved_english) {
        setLastSavedYamlPath(englishYamlPath);
        setLastSavedDatPath(englishDatPath);
      }
      if (result.saved_japanese) {
        setLastSavedJapaneseYamlPath(japaneseYamlPath);
        setLastSavedJapaneseDatPath(japaneseDatPath);
      }
      const saveLabel = result.saved_english && result.saved_japanese
        ? "EN + JP"
        : result.saved_english
          ? "EN"
          : "JP";
      setLastNotice(`Saved ${result.written_count} item entries to ${saveLabel}.`);
      await showMessage(
        `Saved ${result.written_count} item entries to ${saveLabel}.${result.saved_english ? `\nEN YAML: ${englishYamlPath}${englishDatPath ? `\nEN DAT: ${englishDatPath}` : ""}` : ""}${result.saved_japanese ? `${japaneseYamlPath ? `\nJP YAML: ${japaneseYamlPath}` : ""}${japaneseDatPath ? `\nJP DAT: ${japaneseDatPath}` : ""}` : ""}`,
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
        <h1 class="m-0">Item Editor</h1>
        <div class="flex flex-col items-end gap-0.5 text-xs">
          <Show when={lastSavedYamlPath()}>
            <div class="max-w-[62vw] text-right truncate">
              Last saved EN YAML: <span class="font-mono text-green-200">{lastSavedYamlPath()}</span>
            </div>
          </Show>
          <Show when={lastSavedDatPath()}>
            <div class="max-w-[62vw] text-right truncate">
              Last saved EN DAT: <span class="font-mono text-green-200">{lastSavedDatPath()}</span>
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
              Pick an item DAT set. Kraken will load the English and Japanese item text together when both exist.
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
                      disabled={isResolvingDat()}
                      title={option.has_jp ? "Loads paired English and Japanese item text." : "Loads English-only item text."}
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

          <div class="rounded-md border border-amber-700/60 bg-amber-950/15 px-3 py-2">
            <div class="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-200">Direct Edit Workflow</div>
            <div class="mt-1 text-[13px] text-amber-100">
              This editor treats each item DAT as one paired dataset. Common item fields stay shared, while English
              and Japanese text fields can be edited side by side and saved together.
            </div>
            <div class="mt-2 text-[13px] text-amber-200/90">
              1. Click <span class="font-semibold">Make all Base DATs</span>. When all DATs are present it will say "All Dats Made".
              <br />
              2. Choose an item DAT set you want to edit, like <span class="font-semibold">Armor</span>.
              <br />
              3. Load it, edit EN and JP text together, then save both outputs at once.
            </div>
            <div class="mt-3">
              <button
                class={`${compactButtonClass()} ${allBaseDatsMade() ? "opacity-60 cursor-not-allowed" : ""}`}
                disabled={isLoading() || isResolvingDat() || isMakingBaseDats() || !getProjectFolder() || !!allBaseDatsMade()}
                onClick={makeAllBaseDats}
              >
                {isMakingBaseDats() ? "Making base DATs..." : allBaseDatsMade() ? "All Dats Made" : "Make all Base DATs"}
              </button>
            </div>
          </div>

          <div class="min-w-0 flex flex-col gap-1 text-xs">
            <div class="flex items-center gap-2">
              <span class="uppercase tracking-[0.08em] text-slate-400">EN Source</span>
              <span class="font-mono truncate" title={itemPath() || "Not loaded"}>
                {itemPath() || "Not loaded"}
              </span>
            </div>
            <Show when={japaneseItemPath()}>
              <div class="flex items-center gap-2">
                <span class="uppercase tracking-[0.08em] text-slate-400">JP Source</span>
                <span class="font-mono truncate" title={japaneseItemPath()}>
                  {japaneseItemPath()}
                </span>
              </div>
            </Show>
          </div>

          <div class="text-[11px] text-slate-400">
            {pathStatusText()}
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class={compactButtonClass()} disabled={isLoading() || isResolvingDat() || isMakingBaseDats() || !canLoadSelectedFile()} onClick={() => void loadItemData()}>
              {isLoading() ? "Reloading..." : "Reload"}
            </button>

            <button
              class={compactButtonClass(showEditedOnly())}
              disabled={rows.length === 0}
              onClick={() => setShowEditedOnly(!showEditedOnly())}
            >
              {showEditedOnly() ? "Showing edited rows" : "Showing all rows"}
            </button>

            <button
              class={compactButtonClass()}
              disabled={isSaving() || isResolvingDat() || isMakingBaseDats() || rows.length === 0}
              onClick={() => {
                void saveEdited("english");
              }}
            >
              {isSaving() ? "Saving..." : "Save EN"}
            </button>

            <button
              class={compactButtonClass()}
              disabled={isSaving() || isResolvingDat() || isMakingBaseDats() || rows.length === 0 || !japaneseItemPath()}
              onClick={() => {
                void saveEdited("japanese");
              }}
            >
              {isSaving() ? "Saving..." : "Save JP"}
            </button>

            <button
              class={compactButtonClass()}
              disabled={isSaving() || isResolvingDat() || isMakingBaseDats() || rows.length === 0}
              onClick={() => {
                void saveEdited("both");
              }}
            >
              {isSaving() ? "Saving..." : "Save EN + JP"}
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
              <div class="flex flex-col items-end gap-1">
                <div class="text-slate-300">
                  Loaded: {rows.length} | Edited: {editedRowIds().size}
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button
                    class={compactButtonClass()}
                    disabled={isLoading() || isSaving() || isResolvingDat() || isMakingBaseDats() || isResettingToRetailBase() || !selectedDatDescriptor() || !allBaseDatsMade()}
                    onClick={() => {
                      void resetItemDatToRetailBase();
                    }}
                  >
                    {isResettingToRetailBase() ? "Resetting..." : "Reset DAT to Retail Base"}
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
          <div class={leftPanelCollapsed() ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 lg:grid-cols-[minmax(17.75rem,21.75rem)_minmax(0,1fr)] gap-3"}>
            <Show when={!leftPanelCollapsed()}>
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
                        <td colSpan={ITEM_EDITOR_COLUMN_COUNT} style={{ height: `${virtualWindow().topPadding}px`, padding: "0", border: "0" }}></td>
                      </tr>
                    </Show>
                    <For each={visibleRows()}>
                      {(row) => (
                        <tr
                          class={`${editedRowIds().has(row.row) ? "bg-rose-950/20" : ""} ${selectedRowId() === row.row ? "bg-sky-900/35" : ""} cursor-pointer`}
                          onMouseDown={() => setSelectedRowId(row.row)}
                          onClick={() => setSelectedRowId(row.row)}
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
                        <td colSpan={ITEM_EDITOR_COLUMN_COUNT} style={{ height: `${virtualWindow().bottomPadding}px`, padding: "0", border: "0" }}></td>
                      </tr>
                    </Show>
                  </tbody>
                </table>
              </div>
            </Show>

            <div class="border border-slate-700 rounded-md p-3">
              <div class="mb-3 flex justify-start">
                <button
                  class={compactButtonClass(leftPanelCollapsed())}
                  onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed())}
                >
                  {leftPanelCollapsed() ? "Show Item List" : "Collapse Item List"}
                </button>
              </div>
              <Show
                when={selectedRow()}
                keyed
                fallback={<div class="text-sm text-slate-300">Select a row to edit detailed fields.</div>}
              >
                {(row) => {
                  const rowId = row.row;
                  const originalFlags = () => normalizedStringList(row.old_flags);
                  const targetFlags = () => normalizedStringList(row.new_flags ?? row.old_flags);
                  const originalJobs = () => normalizedStringList(row.old_jobs);
                  const targetJobs = () => normalizedStringList(row.new_jobs ?? row.old_jobs);
                  const hasEquipmentJobs = row.old_jobs !== null || row.new_jobs !== null;
                  const hasWeaponData = row.old_weapon_damage !== null || row.new_weapon_damage !== null;
                  const itemTypeOptions = Array.from(new Set([
                    ...ITEM_TYPE_OPTIONS,
                    ...(row.old_item_type ? [row.old_item_type] : []),
                    ...(row.new_item_type ? [row.new_item_type] : []),
                  ]));
                  const weaponSkillTypeOptions = Array.from(new Set([
                    ...WEAPON_SKILL_TYPE_OPTIONS,
                    ...(row.old_weapon_skill_type ? [row.old_weapon_skill_type] : []),
                    ...(row.new_weapon_skill_type ? [row.new_weapon_skill_type] : []),
                  ]));
                  const validTargetPresetOptions = (() => {
                    const currentTargets = normalizedStringList(row.new_valid_targets ?? row.old_valid_targets);
                    const currentKey = validTargetPresetKey(currentTargets);
                    const hasPreset = VALID_TARGET_PRESETS.some((preset) => validTargetPresetKey(preset.values) === currentKey);
                    return hasPreset
                      ? VALID_TARGET_PRESETS
                      : [...VALID_TARGET_PRESETS, { label: currentTargets.join(", ") || "Custom", values: currentTargets }];
                  })();
                  const slotPresetOptions = (() => {
                    const currentSlots = normalizedStringList(row.new_slots ?? row.old_slots);
                    const currentKey = slotPresetKey(currentSlots);
                    const hasPreset = SLOT_PRESETS.some((preset) => slotPresetKey(preset.values) === currentKey);
                    return hasPreset
                      ? SLOT_PRESETS
                      : [...SLOT_PRESETS, { label: currentSlots.join(", ") || "Custom", values: currentSlots }];
                  })();
                  const previewIconUrl = () => iconBytesToDataUrl(row.new_icon_bytes ?? row.old_icon_bytes);
                  const previewEnglishName = () => displayItemName(row.new_en_name ?? row.old_en_name ?? row.new_jp_name ?? row.old_jp_name, "Unknown item");
                  const previewEnglishDescription = () => (row.new_en_description ?? "").trim() || "No English description.";
                  const previewFlags = () => normalizedStringList(row.new_flags ?? row.old_flags);
                  const hasRareFlag = () => previewFlags().includes("Rare");
                  const hasExclusiveFlag = () => previewFlags().includes("Ex");
                  const previewLevelJobsText = () => {
                    const parts: string[] = [];
                    const level = row.new_level ?? row.old_level;
                    if (level !== null && level !== undefined) {
                      parts.push(`LV ${level}`);
                    }

                    const jobs = inGameSortedJobs(row.new_jobs ?? row.old_jobs);
                    if (jobs.length > 0) {
                      parts.push(jobs.includes("All") ? "All Jobs" : jobs.join(" "));
                    }

                    return parts.length > 0 ? parts.join(" ") : null;
                  };
                  const flagOptions = Array.from(new Set([...ITEM_FLAG_OPTIONS, ...(row.old_flags ?? []), ...(row.new_flags ?? [])])).sort();
                  const jobOptions = Array.from(new Set([...ITEM_JOB_OPTIONS, ...(row.old_jobs ?? []), ...(row.new_jobs ?? [])])).sort();

                  return (
                    <div class="flex flex-col gap-3">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-sm font-semibold">
                          Row {row.row}:{" "}
                          <span class={isEmptyItemName(row.new_en_name ?? row.old_en_name) ? "text-slate-400 italic" : ""}>
                            {displayItemName(row.new_en_name ?? row.old_en_name ?? row.new_jp_name ?? row.old_jp_name, "Unknown item")}
                          </span>
                          <Show when={row.has_japanese && shouldShowJapaneseName(row.new_en_name ?? row.old_en_name, row.new_jp_name ?? row.old_jp_name)}>
                            <span class="ml-2 text-xs font-normal text-slate-400">
                              JP: {displayItemName(row.new_jp_name ?? row.old_jp_name, "-")}
                            </span>
                          </Show>
                        </div>
                        <div class="flex items-center gap-2">
                          <Show when={isChangedRow(row)}>
                            <>
                              <div class="rounded-full border border-rose-500/60 bg-rose-950/35 px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-rose-200">
                                Edited
                              </div>
                              <button
                                class={compactButtonClass()}
                                onClick={() => resetRowToOriginal(rowId)}
                              >
                                Reset
                              </button>
                            </>
                          </Show>
                        </div>
                      </div>

                      <div class="text-xs text-slate-400">
                        Edit shared item fields once, then adjust English and Japanese text independently below. Save writes both DATs together.
                      </div>

                      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-3 text-sm items-start">
                        <div class="border border-slate-700 rounded-md p-2">
                          <div class="mb-2 font-semibold text-slate-200">Edit</div>
                          <div class="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-2">
                            <div class="grid grid-cols-[minmax(5.75rem,auto)_minmax(0,1fr)] gap-y-2 gap-x-2 content-start xl:col-span-2">
                              <div class="text-slate-300">EN Name:</div>
                              <input
                                class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_en_name !== row.new_en_name)}`}
                                type="text"
                                value={row.new_en_name ?? ""}
                                title={displayItemName(row.new_en_name ?? row.old_en_name)}
                                onInput={(e) => setRowNewEnglishName(rowId, e.currentTarget.value)}
                              />

                              <Show when={row.has_japanese}>
                                <>
                                  <div class="text-slate-300">JP Name:</div>
                                  <input
                                    class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_jp_name ?? null) !== (row.new_jp_name ?? null))}`}
                                    type="text"
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

                            <Show when={hasWeaponData}>
                              <div class="grid grid-cols-[minmax(5.75rem,auto)_minmax(0,1fr)] gap-y-2 gap-x-2 content-start border-t border-slate-700 pt-2 xl:col-span-2">
                                <div class="text-slate-300">Damage:</div>
                                <input
                                  class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_weapon_damage !== row.new_weapon_damage)}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.new_weapon_damage ?? ""}
                                  onInput={(e) => setRowNewWeaponDamage(rowId, e.currentTarget.value)}
                                />

                                <div class="text-slate-300">Delay:</div>
                                <input
                                  class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_weapon_delay !== row.new_weapon_delay)}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.new_weapon_delay ?? ""}
                                  onInput={(e) => setRowNewWeaponDelay(rowId, e.currentTarget.value)}
                                />

                                <div class="text-slate-300">DPS:</div>
                                <input
                                  class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-600 bg-slate-900 text-slate-200 focus:outline-none ${newFieldClass(row.old_weapon_dps !== row.new_weapon_dps)}`}
                                  type="number"
                                  value={row.new_weapon_dps ?? ""}
                                  readOnly
                                />

                                <div class="text-slate-300">Skill Type:</div>
                                <select
                                  class={`m-0 w-full py-0 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_weapon_skill_type ?? null) !== (row.new_weapon_skill_type ?? null))}`}
                                  value={row.new_weapon_skill_type ?? "None"}
                                  onChange={(e) => setRowNewWeaponSkillType(rowId, e.currentTarget.value)}
                                >
                                  <For each={weaponSkillTypeOptions}>
                                    {(skillType) => <option value={skillType}>{skillType}</option>}
                                  </For>
                                </select>

                                <div class="text-slate-300">Jug Size:</div>
                                <input
                                  class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_weapon_jug_size !== row.new_weapon_jug_size)}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.new_weapon_jug_size ?? ""}
                                  onInput={(e) => setRowNewWeaponJugSize(rowId, e.currentTarget.value)}
                                />

                                <div class="text-slate-300">Emote:</div>
                                <input
                                  class={`hide-spin-buttons m-0 w-full py-0 px-2 text-sm font-mono rounded-md border border-slate-500 focus:border-slate-300 focus:outline-none ${newFieldClass(row.old_weapon_emote !== row.new_weapon_emote)}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={row.new_weapon_emote ?? ""}
                                  onInput={(e) => setRowNewWeaponEmote(rowId, e.currentTarget.value)}
                                />
                              </div>
                            </Show>
                          </div>
                        </div>

                        <div class="border border-slate-700 rounded-md p-2">
                          <div class="mb-2 font-semibold text-slate-200">Preview</div>
                          <div class="rounded-md border border-slate-600/80 bg-slate-950/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <div class="flex items-start justify-between gap-3 border-b border-slate-700/80 pb-2">
                              <div class="min-w-0">
                                <div class={`truncate text-lg font-semibold text-slate-100 ${newFieldClass(row.old_en_name !== row.new_en_name)}`}>
                                  <span class={isEmptyItemName(row.new_en_name) ? "text-slate-400 italic" : ""}>
                                    {previewEnglishName()}
                                  </span>
                                </div>
                              </div>

                              <div class="flex shrink-0 items-center gap-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                                <Show when={hasRareFlag()}>
                                  <span class="rounded border border-amber-400/45 bg-amber-950/25 px-1.5 py-0.5 text-amber-200">Rare</span>
                                </Show>
                                <Show when={hasExclusiveFlag()}>
                                  <span class="rounded border border-sky-400/45 bg-sky-950/25 px-1.5 py-0.5 text-sky-200">Ex</span>
                                </Show>
                              </div>
                            </div>

                            <div class="mt-3 flex items-start gap-3">
                              <Show when={previewIconUrl()}>
                                <img
                                  src={previewIconUrl()!}
                                  alt=""
                                  class="h-[5.5rem] w-[5.5rem] shrink-0 rounded-sm border border-slate-700 bg-slate-900 object-contain [image-rendering:pixelated]"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              </Show>

                              <div class="min-w-0 flex-1 space-y-2">
                                <div class={`rounded border border-slate-700/80 bg-slate-900/55 px-3 py-2 text-[13px] leading-5 text-slate-100 whitespace-pre-wrap ${newFieldClass((row.old_en_description ?? null) !== (row.new_en_description ?? null))}`}>
                                  {previewEnglishDescription()}
                                </div>
                                <Show when={previewLevelJobsText()}>
                                  <div class="rounded border border-slate-700/80 bg-slate-900/55 px-2 py-1 text-xs text-slate-200">
                                    {previewLevelJobsText()}
                                  </div>
                                </Show>

                              </div>
                            </div>
                          </div>
                          <div class="mt-3">
                            <div class="mb-1 text-sm font-semibold text-slate-200">Icon Bytes</div>
                            <textarea
                              class={`m-0 min-h-28 w-full resize-y rounded-md border bg-slate-800 px-2 py-1 font-mono text-[11px] leading-4 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_icon_bytes ?? null) !== (row.new_icon_bytes ?? null))}`}
                              spellcheck={false}
                              value={row.new_icon_bytes ?? ""}
                              onInput={(e) => setRowNewIconBytes(rowId, e.currentTarget.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div class="border-t border-slate-700 pt-2">
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                          <div class="border border-slate-700 rounded-md p-2">
                            <div class="mb-2 flex items-center justify-between gap-2">
                              <div class="text-sm font-semibold text-slate-200">Flags</div>
                              <button
                                class={compactButtonClass(flagsSectionCollapsed())}
                                onClick={() => setFlagsSectionCollapsed(!flagsSectionCollapsed())}
                              >
                                {flagsSectionCollapsed() ? "Show" : "Hide"}
                              </button>
                            </div>
                            <Show when={!flagsSectionCollapsed()}>
                              <>
                                <div class="mb-2 text-[11px] text-slate-400">Original: {originalFlags().join(", ") || "None"}</div>
                                <div class="border border-slate-700 rounded-md p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-2">
                                  <For each={flagOptions}>
                                    {(flag) => (
                                      <label class="grid min-w-0 grid-cols-[1rem,minmax(0,1fr)] items-start gap-x-2 text-xs leading-5">
                                        <input
                                          type="checkbox"
                                          class="mt-1"
                                          checked={targetFlags().includes(flag)}
                                          onChange={(e) => toggleRowNewFlag(rowId, flag, e.currentTarget.checked)}
                                        />
                                        <span class={`min-w-0 break-words ${listChangeTextClass(originalFlags(), targetFlags(), flag)}`} title={flag}>{flag}</span>
                                      </label>
                                    )}
                                  </For>
                                </div>
                              </>
                            </Show>
                          </div>

                          <Show
                            when={hasEquipmentJobs}
                          >
                            <div class="border border-slate-700 rounded-md p-2">
                              <div class="mb-2 flex items-center justify-between gap-2">
                                <div class="text-sm font-semibold text-slate-200">Jobs</div>
                                <button
                                  class={compactButtonClass(jobsSectionCollapsed())}
                                  onClick={() => setJobsSectionCollapsed(!jobsSectionCollapsed())}
                                >
                                  {jobsSectionCollapsed() ? "Show" : "Hide"}
                                </button>
                              </div>
                              <Show when={!jobsSectionCollapsed()}>
                                <>
                                  <div class="mb-2 text-[11px] text-slate-400">Original: {originalJobs().join(", ") || "None"}</div>
                                  <div class="border border-slate-700 rounded-md p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-2">
                                    <For each={jobOptions}>
                                      {(job) => (
                                        <label class="grid min-w-0 grid-cols-[1rem,minmax(0,1fr)] items-start gap-x-2 text-xs leading-5">
                                          <input
                                            type="checkbox"
                                            class="mt-1"
                                            checked={targetJobs().includes(job)}
                                            onChange={(e) => toggleRowNewJob(rowId, job, e.currentTarget.checked)}
                                          />
                                          <span class={`min-w-0 break-words ${listChangeTextClass(originalJobs(), targetJobs(), job)}`} title={job}>{job}</span>
                                        </label>
                                      )}
                                    </For>
                                  </div>
                                </>
                              </Show>
                            </div>
                          </Show>
                        </div>
                      </div>

                      <div class="border-t border-slate-700 pt-2">
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                          <div class="border border-slate-700 rounded-md p-2">
                            <div class="mb-2 flex items-center justify-between gap-2">
                              <div class="text-sm font-semibold text-slate-200">English Text</div>
                              <button
                                class={compactButtonClass(englishTextSectionCollapsed())}
                                onClick={() => setEnglishTextSectionCollapsed(!englishTextSectionCollapsed())}
                              >
                                {englishTextSectionCollapsed() ? "Show" : "Hide"}
                              </button>
                            </div>
                            <Show when={!englishTextSectionCollapsed()}>
                              <>
                                <div class="mb-2 text-[11px] text-slate-400">Original English description remains available while you edit.</div>
                                <textarea
                                  class={`m-0 min-h-40 w-full resize-y px-2 py-1 text-sm rounded-md border bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_en_description ?? null) !== (row.new_en_description ?? null))}`}
                                  rows={5}
                                  value={row.new_en_description ?? ""}
                                  onInput={(e) => setRowNewEnglishDescription(rowId, e.currentTarget.value)}
                                />
                                <div class="mt-2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-400 whitespace-pre-wrap">
                                  {row.old_en_description ?? "No original English description."}
                                </div>
                              </>
                            </Show>
                          </div>

                          <Show when={row.has_japanese}>
                            <div class="border border-slate-700 rounded-md p-2">
                              <div class="mb-2 flex items-center justify-between gap-2">
                                <div class="text-sm font-semibold text-slate-200">Japanese Text</div>
                                <button
                                  class={compactButtonClass(japaneseTextSectionCollapsed())}
                                  onClick={() => setJapaneseTextSectionCollapsed(!japaneseTextSectionCollapsed())}
                                >
                                  {japaneseTextSectionCollapsed() ? "Show" : "Hide"}
                                </button>
                              </div>
                              <Show when={!japaneseTextSectionCollapsed()}>
                                <>
                                  <div class="mb-2 text-[11px] text-slate-400">Edit the Japanese item name and description here.</div>
                                  <textarea
                                    class={`m-0 min-h-40 w-full resize-y px-2 py-1 text-sm rounded-md border bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none ${newFieldClass((row.old_jp_description ?? null) !== (row.new_jp_description ?? null))}`}
                                    rows={5}
                                    value={row.new_jp_description ?? ""}
                                    onInput={(e) => setRowNewJapaneseDescription(rowId, e.currentTarget.value)}
                                  />
                                  <div class="mt-2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-400 whitespace-pre-wrap">
                                    {row.old_jp_description ?? "No original Japanese description."}
                                  </div>
                                </>
                              </Show>
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

export default ItemEditorTool;
