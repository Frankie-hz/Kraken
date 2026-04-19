import { Result } from './bindings'
import { invoke as TAURI_INVOKE } from "@tauri-apps/api/core";
declare global {
    interface Window {
        __TAURI_INVOKE__<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    }
}

export async function getZoneModel(zoneId: number) : Promise<Result<any, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("get_zone_model", { zoneId }) };
    } catch (e) {
        if(e instanceof Error) throw e;
        else return { status: "error", error: e  as any };
    }
}

export type EntityDiffChoice = "Old" | "New";

export interface EntityDiffRow {
    row: number;
    old_id: number | null;
    old_name: string | null;
    old_stack_size: number | null;
    old_flags: string[] | null;
    old_jobs: string[] | null;
    old_description: string | null;
    new_id: number | null;
    new_name: string | null;
    new_stack_size: number | null;
    new_flags: string[] | null;
    new_jobs: string[] | null;
    new_description: string | null;
    target_id: number | null;
    choice: EntityDiffChoice;
}

export interface EntityDiffResult {
    rows: EntityDiffRow[];
    old_count: number;
    new_count: number;
    changed_count: number;
}

export interface EntityDiffSaveResult {
    written_count: number;
    kept_old_count: number;
    kept_new_count: number;
    out_yaml_path: string;
    out_dat_path: string | null;
}

export interface SpellDiffRow {
    row: number;
    old_index: number | null;
    old_name: string | null;
    old_mp_cost: number | null;
    old_cast_time: number | null;
    old_recast_time: number | null;
    old_level_required: Record<string, number> | null;
    new_index: number | null;
    new_name: string | null;
    new_mp_cost: number | null;
    new_cast_time: number | null;
    new_recast_time: number | null;
    new_level_required: Record<string, number> | null;
    target_index: number | null;
    choice: EntityDiffChoice;
}

export interface SpellDiffResult {
    rows: SpellDiffRow[];
    old_count: number;
    new_count: number;
    changed_count: number;
}

export interface FolderDiffEntry {
    relative_path: string;
    zone_name: string | null;
    diff_tool: DiffToolKind;
    custom_path: string | null;
    old_retail_path: string | null;
    new_retail_path: string | null;
    custom_exists: boolean;
    retail_changed: boolean;
}

export type DiffToolKind = "Entity" | "Item";

export interface FolderDiffResult {
    scanned_count: number;
    retail_changed_count: number;
    all_files: FolderDiffEntry[];
    changed_files: FolderDiffEntry[];
}

export async function compareEntityNameFiles(oldPath: string, newPath: string): Promise<Result<EntityDiffResult, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("compare_entity_name_files", { oldPath, newPath }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function compareItemFiles(oldPath: string, newPath: string): Promise<Result<EntityDiffResult, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("compare_item_files", { oldPath, newPath }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function compareSpellFiles(oldPath: string, newPath: string): Promise<Result<SpellDiffResult, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("compare_spell_files", { oldPath, newPath }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function saveEntityNameDiff(
    rows: EntityDiffRow[],
    outYamlPath: string,
    outDatPath: string | null,
): Promise<Result<EntityDiffSaveResult, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("save_entity_name_diff", { rows, outYamlPath, outDatPath }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function saveItemDiff(
    oldPath: string,
    newPath: string,
    rows: EntityDiffRow[],
    outYamlPath: string,
    outDatPath: string | null,
): Promise<Result<EntityDiffSaveResult, any>> {
    try {
        return {
            status: "ok",
            data: await TAURI_INVOKE("save_item_diff", { oldPath, newPath, rows, outYamlPath, outDatPath }),
        };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function saveSpellDiff(
    oldPath: string,
    newPath: string,
    rows: SpellDiffRow[],
    outYamlPath: string,
    outDatPath: string | null,
): Promise<Result<EntityDiffSaveResult, any>> {
    try {
        return {
            status: "ok",
            data: await TAURI_INVOKE("save_spell_diff", { oldPath, newPath, rows, outYamlPath, outDatPath }),
        };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function compareEntityNameFolders(
    customDir: string,
    oldRetailDir: string,
    newRetailDir: string,
): Promise<Result<FolderDiffResult, any>> {
    try {
        return {
            status: "ok",
            data: await TAURI_INVOKE("compare_entity_name_folders", {
                customDir,
                oldRetailDir,
                newRetailDir,
            }),
        };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}
