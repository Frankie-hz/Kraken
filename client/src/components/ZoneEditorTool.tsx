import { For, Show, batch, createMemo, createResource, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import {
  HiSolidArrowDown,
  HiSolidArrowUp,
} from "solid-icons/hi";
import { commands, ZoneInfo } from "../bindings";
import {
  ZoneEditorRow,
  copyZoneEntityDatToProject,
  isZoneEntityDatMadeInProject,
  loadZoneEditorData,
  resetZoneEntityDatToRetailBase,
  saveZoneEditorData,
} from "../custom_bindings";
import { showConfirm, showMessage } from "../dialogs";
import { useData } from "../store";
import { projectDisplayPath, unwrap } from "../util";

function rowSignature(row: ZoneEditorRow) {
  return `${row.id}\u0000${row.name}`;
}

function changedRowIndexesFor(rows: ZoneEditorRow[], originalRows: ZoneEditorRow[]) {
  const changed = new Set<number>();
  const rowCount = Math.max(rows.length, originalRows.length);
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows[index];
    const originalRow = originalRows[index];
    if (!row || !originalRow || rowSignature(row) !== rowSignature(originalRow)) {
      changed.add(index);
    }
  }
  return changed;
}

function duplicateIdsFor(rows: ZoneEditorRow[]) {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}

function duplicateIdsSummary(ids: number[]) {
  const visibleIds = ids.slice(0, 5).join(", ");
  if (ids.length <= 5) {
    return visibleIds;
  }

  return `${visibleIds}, +${ids.length - 5} more`;
}

type BulkEditorMode = "rows" | "ids" | "names";

function rowsToBulkText(rows: ZoneEditorRow[], mode: BulkEditorMode) {
  if (mode === "ids") {
    return rows.map((row) => `${row.id}`).join("\n");
  }
  if (mode === "names") {
    return rows.map((row) => row.name).join("\n");
  }
  return rows.map((row) => `${row.id}\t${row.name}`).join("\n");
}

function splitBulkTextRows(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function parseBulkEditorRowsText(text: string) {
  const lines = splitBulkTextRows(text);
  if (lines.length === 0) {
    return { error: "Bulk table is empty." };
  }

  const parsedRows: ZoneEditorRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const tabIndex = line.indexOf("\t");
    if (tabIndex < 0) {
      return { error: `Line ${index + 1} needs an ID and name separated by a tab.` };
    }

    const idText = line.slice(0, tabIndex).trim();
    const parsedId = Number.parseInt(idText, 10);
    if (!Number.isInteger(parsedId) || parsedId < 0) {
      return { error: `Line ${index + 1} has an invalid ID.` };
    }

    parsedRows.push({
      id: parsedId,
      name: line.slice(tabIndex + 1),
    });
  }

  return { rows: parsedRows };
}

function parseBulkEditorIdsText(text: string) {
  const lines = splitBulkTextRows(text);
  if (lines.length === 0) {
    return { error: "Bulk ID list is empty." };
  }

  const ids: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsedId = Number.parseInt(lines[index].trim(), 10);
    if (!Number.isInteger(parsedId) || parsedId < 0) {
      return { error: `Line ${index + 1} has an invalid ID.` };
    }
    ids.push(parsedId);
  }

  return { ids };
}

function parseBulkEditorNamesText(text: string, expectedRowCount: number) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const names = normalized.split("\n");
  while (names.length > expectedRowCount && names[names.length - 1] === "") {
    names.pop();
  }

  if (names.length === 0) {
    return { error: "Bulk name list is empty." };
  }
  if (names.length !== expectedRowCount) {
    return { error: `Bulk name list needs exactly ${expectedRowCount} line(s). It currently has ${names.length}.` };
  }

  return { names };
}

interface ZoneEditorDraft {
  rows: ZoneEditorRow[];
  originalRows: ZoneEditorRow[];
  changedRowIndexes: Set<number>;
  selectedRowIndex: number | null;
  sourcePath: string;
  outputYamlPath: string;
  outputDatPath: string;
  rowFilterText: string;
  notice: string;
}

const compactButtonBaseClass = "my-0 px-1.5 py-0.5 text-xs font-normal shadow-none border rounded-md";
const compactButtonIdleClass = "bg-slate-800 border-slate-500 text-slate-200";
const compactButtonActiveClass = "bg-green-800 border-green-500 text-slate-100";

function compactButtonClass(active = false) {
  return `${compactButtonBaseClass} ${active ? compactButtonActiveClass : compactButtonIdleClass}`;
}

function editedFieldClass(changed: boolean) {
  return changed ? "text-rose-200" : "";
}

function ZoneEditorTool() {
  const {
    folders: { getDatFolder, getProjectFolder },
  } = useData();

  const [zonesResource] = createResource(
    () => getDatFolder(),
    async (datFolder) => {
      if (!datFolder) {
        return [];
      }
      return unwrap(await commands.getZonesForType({ type: "EntityNames", index: 0 }));
    },
    { initialValue: [] as ZoneInfo[] },
  );

  const [selectedZone, setSelectedZone] = createSignal<ZoneInfo | null>(null);
  const [zoneBaseDatMade, { refetch: refetchZoneBaseDatMade }] = createResource(
    () => {
      const zone = selectedZone();
      const projectFolder = getProjectFolder();
      return zone && projectFolder ? zone.id : null;
    },
    async (zoneId) => {
      if (zoneId === null) {
        return false;
      }
      return unwrap(await isZoneEntityDatMadeInProject(zoneId));
    },
    { initialValue: false },
  );

  const [zoneFilterText, setZoneFilterText] = createSignal("");
  const [rowFilterText, setRowFilterText] = createSignal("");
  const [rows, setRows] = createStore<ZoneEditorRow[]>([]);
  const [originalRows, setOriginalRows] = createSignal<ZoneEditorRow[]>([]);
  const [changedRowIndexes, setChangedRowIndexes] = createSignal<Set<number>>(new Set());
  const [zoneDrafts, setZoneDrafts] = createSignal<Map<number, ZoneEditorDraft>>(new Map());
  const [selectedRowIndex, setSelectedRowIndex] = createSignal<number | null>(null);
  const [bulkEditorOpen, setBulkEditorOpen] = createSignal(false);
  const [bulkEditorMode, setBulkEditorMode] = createSignal<BulkEditorMode>("rows");
  const [bulkEditorText, setBulkEditorText] = createSignal("");
  const [sourcePath, setSourcePath] = createSignal("");
  const [outputYamlPath, setOutputYamlPath] = createSignal("");
  const [outputDatPath, setOutputDatPath] = createSignal("");
  const [lastNotice, setLastNotice] = createSignal("");
  const [isLoading, setLoading] = createSignal(false);
  const [isSaving, setSaving] = createSignal(false);
  const [isMakingBaseDat, setMakingBaseDat] = createSignal(false);
  const [isUpdatingBaseDat, setUpdatingBaseDat] = createSignal(false);
  const [isResettingToRetailBase, setResettingToRetailBase] = createSignal(false);
  let bulkNameIdsRef: HTMLTextAreaElement | undefined;

  const filteredZones = createMemo(() => {
    const filter = zoneFilterText().trim().toLowerCase();
    const zones = [...zonesResource()].sort((left, right) => left.name.localeCompare(right.name));
    if (!filter) {
      return zones;
    }

    return zones.filter((zone) =>
      `${zone.id} ${zone.name} ${zone.dat_path}`.toLowerCase().includes(filter)
    );
  });

  const filteredRows = createMemo(() => {
    const filter = rowFilterText().trim().toLowerCase();
    if (!filter) {
      return rows.map((row, index) => ({ row, index }));
    }

    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => `${row.id} ${row.name}`.toLowerCase().includes(filter));
  });

  const changedCount = createMemo(() => changedRowIndexes().size);
  const duplicateIds = createMemo(() => duplicateIdsFor(rows));
  const duplicateIdSummary = createMemo(() => duplicateIdsSummary(duplicateIds()));
  const idChanged = (index: number, id: number) => originalRows()[index]?.id !== id;
  const nameChanged = (index: number, name: string) => originalRows()[index]?.name !== name;
  const bulkNameIdsText = createMemo(() => {
    return rows.map((row) => `${row.id}`).join("\n");
  });

  const selectedZoneTitle = createMemo(() => {
    const zone = selectedZone();
    return zone ? `${zone.name} (${zone.id})` : "No zone selected";
  });
  const sourceDisplayPath = createMemo(() => projectDisplayPath(sourcePath(), getProjectFolder()));
  const yamlDisplayPath = createMemo(() => projectDisplayPath(outputYamlPath(), getProjectFolder()));
  const datDisplayPath = createMemo(() => projectDisplayPath(outputDatPath(), getProjectFolder()));
  const editedZoneCount = createMemo(() =>
    zoneDrafts().size + (changedCount() > 0 && !zoneDrafts().has(selectedZone()?.id ?? -1) ? 1 : 0)
  );

  const cloneRows = (sourceRows: ZoneEditorRow[]) => sourceRows.map((row) => ({ ...row }));

  const setAllRows = (
    nextRows: ZoneEditorRow[],
    options: { selectedRowIndex?: number | null; notice?: string; syncBulkEditor?: boolean } = {},
  ) => {
    batch(() => {
      setRows(() => nextRows);
      setChangedRowIndexes(changedRowIndexesFor(nextRows, originalRows()));
      if ("selectedRowIndex" in options) {
        setSelectedRowIndex(options.selectedRowIndex ?? null);
      }
      if (options.notice !== undefined) {
        setLastNotice(options.notice);
      }
      if (options.syncBulkEditor !== false && bulkEditorOpen()) {
        setBulkEditorText(rowsToBulkText(nextRows, bulkEditorMode()));
      }
    });
  };

  const applyDraft = (draft: ZoneEditorDraft) => {
    batch(() => {
      setRows(() => cloneRows(draft.rows));
      setOriginalRows(cloneRows(draft.originalRows));
      setChangedRowIndexes(new Set(draft.changedRowIndexes));
      setSelectedRowIndex(draft.selectedRowIndex);
      setBulkEditorText(rowsToBulkText(draft.rows, bulkEditorMode()));
      setSourcePath(draft.sourcePath);
      setOutputYamlPath(draft.outputYamlPath);
      setOutputDatPath(draft.outputDatPath);
      setRowFilterText(draft.rowFilterText);
      setLastNotice(draft.notice);
    });
  };

  const cacheCurrentDraft = () => {
    const zone = selectedZone();
    if (!zone || rows.length === 0) {
      return;
    }

    const changed = changedRowIndexes();
    setZoneDrafts((current) => {
      const next = new Map(current);
      if (changed.size === 0) {
        next.delete(zone.id);
        return next;
      }

      next.set(zone.id, {
        rows: cloneRows(rows),
        originalRows: cloneRows(originalRows()),
        changedRowIndexes: new Set(changed),
        selectedRowIndex: selectedRowIndex(),
        sourcePath: sourcePath(),
        outputYamlPath: outputYamlPath(),
        outputDatPath: outputDatPath(),
        rowFilterText: rowFilterText(),
        notice: `${changed.size} unsaved edit(s) in ${zone.name}.`,
      });
      return next;
    });
  };

  const zoneHasUnsavedDraft = (zoneId: number) => {
    if (selectedZone()?.id === zoneId) {
      return changedCount() > 0;
    }
    return (zoneDrafts().get(zoneId)?.changedRowIndexes.size ?? 0) > 0;
  };

  const clearLoadedRows = () => {
    batch(() => {
      setRows([]);
      setOriginalRows([]);
      setChangedRowIndexes(new Set());
      setSelectedRowIndex(null);
      setSourcePath("");
      setOutputYamlPath("");
      setOutputDatPath("");
      setLastNotice("");
      setRowFilterText("");
      setBulkEditorText("");
    });
  };

  const loadRows = async (zone = selectedZone(), baseAlreadyChecked = false) => {
    if (!zone) {
      await showMessage("Select a zone first.", { title: "Zone Required", kind: "warning" });
      return;
    }
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken can stage and save zone entity edits.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }
    if (!baseAlreadyChecked && !unwrap(await isZoneEntityDatMadeInProject(zone.id))) {
      await showMessage("Make the Base Entity DAT for this zone first.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      await refetchZoneBaseDatMade();
      return;
    }

    setLoading(true);
    setLastNotice(`Loading entities for ${zone.name}...`);
    try {
      const result = unwrap(await loadZoneEditorData(zone.id));
      if (selectedZone()?.id !== zone.id) {
        return;
      }
      batch(() => {
        setRows(() => result.rows);
        setOriginalRows(cloneRows(result.rows));
        setChangedRowIndexes(new Set());
        setSelectedRowIndex(result.rows.length > 0 ? 0 : null);
        setBulkEditorText(rowsToBulkText(result.rows, bulkEditorMode()));
        setSourcePath(result.source_path);
        setOutputYamlPath(result.output_yaml_path);
        setOutputDatPath(result.output_dat_path);
        setZoneDrafts((current) => {
          const next = new Map(current);
          next.delete(zone.id);
          return next;
        });
        setLastNotice(`Loaded ${result.rows.length} entities from ${result.zone_name}.`);
      });
      await refetchZoneBaseDatMade();
    } catch (err) {
      await showMessage(`${err}`, { title: "Load Error", kind: "error" });
    } finally {
      if (selectedZone()?.id === zone.id) {
        setLoading(false);
      }
    }
  };

  const selectZone = async (zone: ZoneInfo) => {
    if (selectedZone()?.id === zone.id && rows.length > 0) {
      return;
    }

    cacheCurrentDraft();
    setSelectedZone(zone);

    const draft = zoneDrafts().get(zone.id);
    if (draft) {
      applyDraft(draft);
      setLastNotice(`Restored ${draft.changedRowIndexes.size} unsaved edit(s) for ${zone.name}.`);
      return;
    }

    if (!getProjectFolder()) {
      clearLoadedRows();
      setLastNotice("Set a Project Folder before loading this zone.");
      return;
    }

    setLoading(true);
    setLastNotice(`Checking ${zone.name}...`);
    try {
      const baseMade = unwrap(await isZoneEntityDatMadeInProject(zone.id));
      if (selectedZone()?.id !== zone.id) {
        return;
      }
      await refetchZoneBaseDatMade();
      if (baseMade) {
        await loadRows(zone, true);
      } else {
        clearLoadedRows();
        setLastNotice("Make the base Entity DAT before editing this zone.");
      }
    } catch (err) {
      await showMessage(`${err}`, { title: "Zone Select Error", kind: "error" });
    } finally {
      if (selectedZone()?.id === zone.id) {
        setLoading(false);
      }
    }
  };

  const makeBaseDat = async () => {
    const zone = selectedZone();
    if (!zone) {
      await showMessage("Select a zone first.", { title: "Zone Required", kind: "warning" });
      return;
    }
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken knows where to place the copied Entity DAT.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }

    setMakingBaseDat(true);
    try {
      const copiedPath = unwrap(await copyZoneEntityDatToProject(zone.id));
      await refetchZoneBaseDatMade();
      setLastNotice("Copied base Entity DAT into Retail Base and Custom.");
      await loadRows(zone);
      await showMessage(`Copied base Entity DAT into Retail Base and Custom.\nCustom DAT: ${copiedPath}`, {
        title: "Base DAT Ready",
        kind: "info",
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Copy Error", kind: "error" });
    } finally {
      setMakingBaseDat(false);
    }
  };

  const updateBaseDatFromSource = async () => {
    const zone = selectedZone();
    if (!zone) {
      await showMessage("Select a zone first.", { title: "Zone Required", kind: "warning" });
      return;
    }
    if (!getProjectFolder()) {
      await showMessage("Set a Project Folder first so Kraken knows where to update the Base Entity DAT.", {
        title: "Project Folder Required",
        kind: "warning",
      });
      return;
    }
    if (!zoneBaseDatMade()) {
      await showMessage("Make the Base Entity DAT first before updating it from FFXI Source.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      return;
    }

    setUpdatingBaseDat(true);
    try {
      const customPath = unwrap(await copyZoneEntityDatToProject(zone.id));
      await refetchZoneBaseDatMade();
      setLastNotice(`Updated Retail Base Entity DAT for ${zone.name} from FFXI Source. Custom Entity DAT was not overwritten.`);
      await showMessage(
        `Updated Retail Base Entity DAT for ${zone.name} from FFXI Source.\nCustom DAT kept at: ${customPath}`,
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

  const resetToRetailBase = async () => {
    const zone = selectedZone();
    if (!zone) {
      await showMessage("Select a zone first.", { title: "Zone Required", kind: "warning" });
      return;
    }
    if (!zoneBaseDatMade()) {
      await showMessage("Make the Base Entity DAT first so Kraken has a Retail Base file to restore from.", {
        title: "Base DAT Required",
        kind: "warning",
      });
      return;
    }

    const confirmed = await showConfirm(
      "Reset this zone's Entity DAT in Custom back to Retail Base?",
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
      unwrap(await resetZoneEntityDatToRetailBase(zone.id));
      await loadRows(zone);
      setLastNotice("Reset Entity DAT to Retail Base.");
    } catch (err) {
      await showMessage(`${err}`, { title: "Reset Error", kind: "error" });
    } finally {
      setResettingToRetailBase(false);
    }
  };

  const setRowId = (index: number, value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }
    const nextRow = { ...rows[index], id: parsed };
    const nextRows = cloneRows(rows);
    nextRows[index] = nextRow;
    setAllRows(nextRows);
  };

  const setRowName = (index: number, name: string) => {
    const nextRow = { ...rows[index], name };
    const nextRows = cloneRows(rows);
    nextRows[index] = nextRow;
    setAllRows(nextRows);
  };

  const applyNamePaste = (startIndex: number, text: string) => {
    const lines = splitBulkTextRows(text);
    if (lines.length === 0 || (lines.length === 1 && !text.includes("\t"))) {
      return false;
    }

    const next = cloneRows(rows);
    let applied = 0;
    for (const line of lines) {
      const targetIndex = startIndex + applied;
      if (targetIndex >= next.length) {
        break;
      }

      const cells = line.split("\t");
      next[targetIndex] = {
        ...next[targetIndex],
        name: cells[cells.length - 1] ?? "",
      };
      applied += 1;
    }

    if (applied === 0) {
      return false;
    }

    setAllRows(next, {
      selectedRowIndex: startIndex + applied - 1,
      notice: `Pasted ${applied} name row(s).`,
    });
    return true;
  };

  const applyRowPaste = (startIndex: number, text: string) => {
    const lines = splitBulkTextRows(text);
    if (lines.length === 0 || !text.includes("\t")) {
      return false;
    }

    const parsedRows: ZoneEditorRow[] = [];
    for (const line of lines) {
      const tabIndex = line.indexOf("\t");
      const parsedId = Number.parseInt(line.slice(0, tabIndex).trim(), 10);
      if (!Number.isInteger(parsedId) || parsedId < 0) {
        return false;
      }

      parsedRows.push({
        id: parsedId,
        name: line.slice(tabIndex + 1),
      });
    }

    const next = cloneRows(rows);
    let applied = 0;
    for (const row of parsedRows) {
      const targetIndex = startIndex + applied;
      if (targetIndex >= next.length) {
        break;
      }

      next[targetIndex] = row;
      applied += 1;
    }

    if (applied === 0) {
      return false;
    }

    setAllRows(next, {
      selectedRowIndex: startIndex + applied - 1,
      notice: `Pasted ${applied} table row(s).`,
    });
    return true;
  };

  const handleNamePaste = (index: number, event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (applyNamePaste(index, text)) {
      event.preventDefault();
    }
  };

  const handleIdPaste = (index: number, event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (applyRowPaste(index, text)) {
      event.preventDefault();
    }
  };

  const insertRowAt = (index: number) => {
    const next = [...rows];
    const previousId = index > 0 ? rows[index - 1]?.id : undefined;
    const nextId = rows[index]?.id;
    const insertedId = previousId !== undefined ? previousId + 1 : nextId ?? 0;
    next.splice(index, 0, { id: insertedId, name: "" });
    setAllRows(next, {
      selectedRowIndex: index,
      notice: "Inserted a blank entity row.",
    });
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }

    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(targetIndex, 0, row);
    setAllRows(next, {
      selectedRowIndex: targetIndex,
      notice: "Moved row.",
    });
  };

  const toggleBulkEditor = () => {
    const nextOpen = !bulkEditorOpen();
    setBulkEditorOpen(nextOpen);
    if (nextOpen) {
      setBulkEditorText(rowsToBulkText(rows, bulkEditorMode()));
    }
  };

  const refreshBulkEditorFromRows = () => {
    setBulkEditorText(rowsToBulkText(rows, bulkEditorMode()));
    setLastNotice("Bulk table text refreshed.");
  };

  const selectBulkEditorMode = (mode: BulkEditorMode) => {
    setBulkEditorMode(mode);
    setBulkEditorText(rowsToBulkText(rows, mode));
  };

  const applyBulkEditorRows = async () => {
    const mode = bulkEditorMode();
    if (mode === "rows") {
      const result = parseBulkEditorRowsText(bulkEditorText());
      if ("error" in result) {
        await showMessage(result.error, { title: "Bulk Edit Error", kind: "error" });
        return;
      }

      const selectedIndex = result.rows.length > 0
        ? Math.min(selectedRowIndex() ?? 0, result.rows.length - 1)
        : null;
      setAllRows(result.rows, {
        selectedRowIndex: selectedIndex,
        notice: `Applied ${result.rows.length} bulk row(s).`,
        syncBulkEditor: false,
      });
      setBulkEditorText(rowsToBulkText(result.rows, mode));
      return;
    }

    if (mode === "ids") {
      const result = parseBulkEditorIdsText(bulkEditorText());
      if ("error" in result) {
        await showMessage(result.error, { title: "Bulk Edit Error", kind: "error" });
        return;
      }
      if (result.ids.length > rows.length) {
        await showMessage("Bulk ID list has more lines than the loaded table.", { title: "Bulk Edit Error", kind: "error" });
        return;
      }

      const startIndex = result.ids.length === rows.length ? 0 : selectedRowIndex() ?? 0;
      if (startIndex + result.ids.length > rows.length) {
        await showMessage("Bulk ID list does not fit from the selected row.", { title: "Bulk Edit Error", kind: "error" });
        return;
      }

      const nextRows = cloneRows(rows);
      result.ids.forEach((id, offset) => {
        nextRows[startIndex + offset].id = id;
      });

      setAllRows(nextRows, {
        selectedRowIndex: startIndex + result.ids.length - 1,
        notice: `Applied ${result.ids.length} bulk ID row(s).`,
        syncBulkEditor: false,
      });
      setBulkEditorText(rowsToBulkText(nextRows, mode));
      return;
    }

    const result = parseBulkEditorNamesText(bulkEditorText(), rows.length);
    if ("error" in result) {
      await showMessage(result.error, { title: "Bulk Edit Error", kind: "error" });
      return;
    }

    const nextRows = cloneRows(rows);
    result.names.forEach((name, index) => {
      nextRows[index].name = name;
    });

    setAllRows(nextRows, {
      selectedRowIndex: selectedRowIndex(),
      notice: `Applied ${result.names.length} bulk name row(s).`,
      syncBulkEditor: false,
    });
    setBulkEditorText(rowsToBulkText(nextRows, mode));
  };

  const saveRows = async () => {
    const zone = selectedZone();
    if (!zone) {
      await showMessage("Select a zone first.", { title: "Zone Required", kind: "warning" });
      return;
    }
    if (rows.length === 0) {
      await showMessage("Load the zone entities first.", { title: "Save Blocked", kind: "warning" });
      return;
    }

    setSaving(true);
    try {
      const payloadRows = rows.map((row) => ({ ...row }));
      const result = unwrap(await saveZoneEditorData(zone.id, payloadRows));
      const savedDuplicateIds = duplicateIds();
      const duplicateNotice = savedDuplicateIds.length > 0
        ? `\nDuplicate IDs preserved: ${duplicateIdsSummary(savedDuplicateIds)}`
        : "";
      batch(() => {
        setOriginalRows(cloneRows(payloadRows));
        setChangedRowIndexes(new Set());
        setZoneDrafts((current) => {
          const next = new Map(current);
          next.delete(zone.id);
          return next;
        });
        setSourcePath(result.out_dat_path);
        setOutputYamlPath(result.out_yaml_path);
        setOutputDatPath(result.out_dat_path);
        setBulkEditorText(rowsToBulkText(payloadRows, bulkEditorMode()));
        setLastNotice(savedDuplicateIds.length > 0
          ? `Saved ${result.written_count} entity rows with duplicate IDs preserved.`
          : `Saved ${result.written_count} entity rows.`);
      });
      await showMessage(`Saved Entity DAT.${duplicateNotice}\nYAML: ${result.out_yaml_path}\nDAT: ${result.out_dat_path}`, {
        title: "Save Complete",
        kind: "info",
      });
    } catch (err) {
      await showMessage(`${err}`, { title: "Save Error", kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="w-full">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <h1 class="m-0">Zone Editor</h1>
        <div class="flex flex-col items-end gap-0.5 text-xs">
          <div class="max-w-[62vw] text-right truncate">
            Selected: <span class="font-mono text-green-200">{selectedZoneTitle()}</span>
          </div>
        </div>
      </div>
      <hr />

      <div class="mt-3 flex flex-col gap-2">
        <div class="rounded-md border border-slate-700/70 bg-slate-900/20 p-2 flex flex-col gap-2">
          <div class="rounded-md border border-amber-700/60 bg-amber-950/15 px-3 py-2">
            <div class="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-200">Direct Edit Workflow</div>
            <div class="mt-1 text-[13px] text-amber-100">
              Select a zone, make its base Entity DAT, then edit ID and name rows from the Custom copy.
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button class={compactButtonClass(zoneBaseDatMade())} disabled={!selectedZone() || isMakingBaseDat() || isUpdatingBaseDat() || !getProjectFolder() || zoneBaseDatMade()} onClick={makeBaseDat}>
                {isMakingBaseDat() ? "Making Base..." : zoneBaseDatMade() ? "Base Entity DAT Made" : "Make Base Entity DAT"}
              </button>
              <Show when={zoneBaseDatMade()}>
                <button
                  class={compactButtonClass()}
                  disabled={!selectedZone() || isMakingBaseDat() || isUpdatingBaseDat() || !getProjectFolder()}
                  onClick={updateBaseDatFromSource}
                >
                  {isUpdatingBaseDat() ? "Updating Base..." : "Update Base From FFXI Source"}
                </button>
              </Show>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class={compactButtonClass()} disabled={!selectedZone() || isLoading() || isUpdatingBaseDat() || !zoneBaseDatMade()} onClick={() => void loadRows()}>
              {isLoading() ? "Reloading..." : "Reload"}
            </button>
            <button class={compactButtonClass()} disabled={isSaving() || isUpdatingBaseDat() || rows.length === 0} onClick={saveRows}>
              {isSaving() ? "Saving..." : duplicateIds().length > 0 ? "Save With Duplicate IDs" : "Save"}
            </button>
            <button class={compactButtonClass()} disabled={isUpdatingBaseDat() || isResettingToRetailBase() || !zoneBaseDatMade()} onClick={resetToRetailBase}>
              {isResettingToRetailBase() ? "Resetting..." : "Reset To Retail Base"}
            </button>
            <Show when={rows.length > 0}>
              <span class="text-xs text-slate-300">Edited: {changedCount()}</span>
            </Show>
            <Show when={duplicateIds().length > 0}>
              <span class="text-xs text-amber-200" title={`Duplicate IDs preserved on save: ${duplicateIds().join(", ")}`}>
                Duplicate IDs: {duplicateIdSummary()}
              </span>
            </Show>
            <Show when={editedZoneCount() > 0}>
              <span class="text-xs text-slate-300">Draft zones: {editedZoneCount()}</span>
            </Show>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-x-3 gap-y-1 text-xs text-slate-400">
            <div class="min-w-0 truncate" title={sourcePath() || "Not loaded"}>
              Source: <span class="font-mono text-slate-200">{sourceDisplayPath() || "Not loaded"}</span>
            </div>
            <div class="min-w-0 truncate" title={outputYamlPath() || "Not loaded"}>
              YAML: <span class="font-mono text-slate-200">{yamlDisplayPath() || "Not loaded"}</span>
            </div>
            <div class="min-w-0 truncate" title={outputDatPath() || "Not loaded"}>
              DAT: <span class="font-mono text-slate-200">{datDisplayPath() || "Not loaded"}</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Show when={lastNotice()}>
              <span class="text-sm italic text-slate-300">{lastNotice()}</span>
            </Show>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)] gap-3">
          <div class="min-w-0 flex flex-col gap-2">
            <input
              class="m-0 py-0.5 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
              placeholder="Filter zones"
              value={zoneFilterText()}
              onInput={(event) => setZoneFilterText(event.currentTarget.value)}
            />

            <Show when={!zonesResource.loading} fallback={<div class="loading-state">Loading zones...</div>}>
              <div class="max-h-[70vh] overflow-y-auto overflow-x-hidden border border-slate-700 rounded-md">
                <table class="w-full">
                  <thead class="sticky top-0 z-10">
                    <tr>
                      <th>Name</th>
                      <th class="w-20">ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filteredZones()}>
                      {(zone) => (
                        <tr
                          class={selectedZone()?.id === zone.id ? "bg-slate-700" : ""}
                          onClick={() => void selectZone(zone)}
                        >
                          <td class="font-semibold text-slate-100">{zone.name}</td>
                          <td class="font-mono">
                            <span>{zone.id}</span>
                            <Show when={zoneHasUnsavedDraft(zone.id)}>
                              <span class="ml-1 text-rose-200">*</span>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>

          <div class="min-w-0 flex flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <input
                class="m-0 min-w-[12rem] flex-1 md:flex-none md:w-64 py-0.5 px-2 text-sm rounded-md border border-slate-500 bg-slate-800 text-slate-100 focus:border-slate-300 focus:outline-none"
                placeholder="Filter entities"
                value={rowFilterText()}
                onInput={(event) => setRowFilterText(event.currentTarget.value)}
              />
              <button class={compactButtonClass()} disabled={selectedRowIndex() === null} onClick={() => insertRowAt(selectedRowIndex() ?? 0)}>
                Insert Above
              </button>
              <button
                class={compactButtonClass()}
                disabled={selectedRowIndex() === null}
                onClick={() => insertRowAt((selectedRowIndex() ?? rows.length - 1) + 1)}
              >
                Insert Below
              </button>
              <button
                class={compactButtonClass()}
                disabled={selectedRowIndex() === null || selectedRowIndex() === 0}
                onClick={() => moveRow(selectedRowIndex() ?? 0, -1)}
              >
                <span class="inline-flex items-center gap-2"><HiSolidArrowUp /> Move Up</span>
              </button>
              <button
                class={compactButtonClass()}
                disabled={selectedRowIndex() === null || selectedRowIndex() === rows.length - 1}
                onClick={() => moveRow(selectedRowIndex() ?? 0, 1)}
              >
                <span class="inline-flex items-center gap-2"><HiSolidArrowDown /> Move Down</span>
              </button>
              <button class={compactButtonClass(bulkEditorOpen())} disabled={rows.length === 0} onClick={toggleBulkEditor}>
                {bulkEditorOpen() ? "Hide Bulk Edit" : "Bulk Edit"}
              </button>
            </div>

            <Show when={rows.length > 0} fallback={<div class="loading-state">Select a zone to edit its entity names.</div>}>
              <Show when={bulkEditorOpen()}>
                <div class="rounded-md border border-slate-700 bg-slate-900/30 p-2">
                  <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div class="text-xs font-semibold uppercase tracking-[0.08em] text-slate-200">Bulk Table</div>
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="flex overflow-hidden rounded-md border border-slate-600">
                        <button
                          class={`${compactButtonClass(bulkEditorMode() === "rows")} rounded-none border-0`}
                          onClick={() => selectBulkEditorMode("rows")}
                        >
                          Rows
                        </button>
                        <button
                          class={`${compactButtonClass(bulkEditorMode() === "ids")} rounded-none border-0 border-l border-slate-600`}
                          onClick={() => selectBulkEditorMode("ids")}
                        >
                          IDs
                        </button>
                        <button
                          class={`${compactButtonClass(bulkEditorMode() === "names")} rounded-none border-0 border-l border-slate-600`}
                          onClick={() => selectBulkEditorMode("names")}
                        >
                          Names
                        </button>
                      </div>
                      <button class={compactButtonClass()} onClick={refreshBulkEditorFromRows}>
                        Refresh
                      </button>
                      <button class={compactButtonClass()} onClick={() => void applyBulkEditorRows()}>
                        Apply
                      </button>
                    </div>
                  </div>
                  <Show
                    when={bulkEditorMode() === "names"}
                    fallback={
                      <textarea
                        class="m-0 min-h-64 w-full resize-y rounded-md border border-slate-500 bg-slate-800 px-2 py-1 font-mono text-xs leading-5 text-slate-100 focus:border-slate-300 focus:outline-none"
                        autocomplete="off"
                        spellcheck={false}
                        wrap="off"
                        value={bulkEditorText()}
                        onInput={(event) => setBulkEditorText(event.currentTarget.value)}
                      />
                    }
                  >
                    <div class="grid min-h-64 grid-cols-[6rem_minmax(0,1fr)] gap-2">
                      <textarea
                        class="m-0 h-64 resize-none overflow-hidden rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs leading-5 text-slate-300 focus:border-slate-700 focus:outline-none"
                        autocomplete="off"
                        spellcheck={false}
                        readOnly
                        tabIndex={-1}
                        wrap="off"
                        value={bulkNameIdsText()}
                        ref={(el) => {
                          bulkNameIdsRef = el;
                        }}
                      />
                      <textarea
                        class="m-0 h-64 w-full resize-none rounded-md border border-slate-500 bg-slate-800 px-2 py-1 font-mono text-xs leading-5 text-slate-100 focus:border-slate-300 focus:outline-none"
                        autocomplete="off"
                        spellcheck={false}
                        wrap="off"
                        value={bulkEditorText()}
                        onInput={(event) => setBulkEditorText(event.currentTarget.value)}
                        onScroll={(event) => {
                          if (bulkNameIdsRef) {
                            bulkNameIdsRef.scrollTop = event.currentTarget.scrollTop;
                          }
                        }}
                      />
                    </div>
                  </Show>
                </div>
              </Show>
              <div class="max-h-[70vh] overflow-y-auto overflow-x-hidden border border-slate-700 rounded-md">
              <table class="table-auto">
                <thead>
                  <tr>
                    <th class="w-36">ID</th>
                    <th>Name</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={filteredRows()}>
                    {({ row, index }) => (
                      <tr
                        class={selectedRowIndex() === index ? "bg-slate-700" : ""}
                        onClick={() => setSelectedRowIndex(index)}
                      >
                        <td>
                          <input
                            class={`hide-spin-buttons py-1 px-2 font-mono ${editedFieldClass(idChanged(index, row.id))}`}
                            type="number"
                            min={0}
                            step={1}
                            value={row.id}
                            onInput={(event) => setRowId(index, event.currentTarget.value)}
                            onPaste={(event) => handleIdPaste(index, event)}
                          />
                        </td>
                        <td>
                          <input
                            class={`py-1 px-2 ${editedFieldClass(nameChanged(index, row.name))}`}
                            value={row.name}
                            onInput={(event) => setRowName(index, event.currentTarget.value)}
                            onPaste={(event) => handleNamePaste(index, event)}
                          />
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ZoneEditorTool;
