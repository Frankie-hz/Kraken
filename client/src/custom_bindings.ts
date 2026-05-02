import { DatDescriptor, DatLanguage, Result } from './bindings'
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

export async function copyItemDatsToProject(lang?: DatLanguage): Promise<Result<string[], any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("copy_item_dats_to_project", { lang }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function areAllItemDatsMadeInProject(): Promise<Result<boolean, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("are_all_item_dats_made_in_project") };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function resetItemEditorDataToRetailBase(descriptor: DatDescriptor): Promise<Result<string[], any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("reset_item_editor_data_to_retail_base", { descriptor }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function copyZoneEntityDatToProject(zoneId: number): Promise<Result<string, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("copy_zone_entity_dat_to_project", { zoneId }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function resetZoneEntityDatToRetailBase(zoneId: number): Promise<Result<string, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("reset_zone_entity_dat_to_retail_base", { zoneId }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function isZoneEntityDatMadeInProject(zoneId: number): Promise<Result<boolean, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("is_zone_entity_dat_made_in_project", { zoneId }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function copySpellDatToProject(): Promise<Result<string, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("copy_spell_dat_to_project") };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function resetSpellDatToRetailBase(): Promise<Result<string, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("reset_spell_dat_to_retail_base") };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function isSpellDatMadeInProject(): Promise<Result<boolean, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("is_spell_dat_made_in_project") };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function copyAbilityDatToProject(): Promise<Result<string, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("copy_ability_dat_to_project") };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function resetAbilityDatToRetailBase(): Promise<Result<string, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("reset_ability_dat_to_retail_base") };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function isAbilityDatMadeInProject(): Promise<Result<boolean, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("is_ability_dat_made_in_project") };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function resolveDatDescriptorPath(
    descriptor: DatDescriptor,
    lang?: DatLanguage,
): Promise<Result<string, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("resolve_dat_descriptor_path", { descriptor, lang }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export type EntityDiffChoice = "Old" | "New";

export interface ItemEditorRow {
    row: number;
    old_id: number | null;
    new_id: number | null;
    old_stack_size: number | null;
    new_stack_size: number | null;
    old_level: number | null;
    new_level: number | null;
    old_item_type: string | null;
    new_item_type: string | null;
    old_shield_size: number | null;
    new_shield_size: number | null;
    old_max_charges: number | null;
    new_max_charges: number | null;
    old_casting_time: number | null;
    new_casting_time: number | null;
    old_use_delay: number | null;
    new_use_delay: number | null;
    old_reuse_delay: number | null;
    new_reuse_delay: number | null;
    old_valid_targets: string[] | null;
    new_valid_targets: string[] | null;
    old_slots: string[] | null;
    new_slots: string[] | null;
    old_weapon_damage: number | null;
    new_weapon_damage: number | null;
    old_weapon_delay: number | null;
    new_weapon_delay: number | null;
    old_weapon_dps: number | null;
    new_weapon_dps: number | null;
    old_weapon_skill_type: string | null;
    new_weapon_skill_type: string | null;
    old_weapon_jug_size: number | null;
    new_weapon_jug_size: number | null;
    old_weapon_emote: number | null;
    new_weapon_emote: number | null;
    old_icon_bytes: string | null;
    new_icon_bytes: string | null;
    old_flags: string[] | null;
    new_flags: string[] | null;
    old_jobs: string[] | null;
    new_jobs: string[] | null;
    old_en_name: string | null;
    new_en_name: string | null;
    old_en_article_type: string | null;
    new_en_article_type: string | null;
    old_en_singular_name: string | null;
    new_en_singular_name: string | null;
    old_en_plural_name: string | null;
    new_en_plural_name: string | null;
    old_en_description: string | null;
    new_en_description: string | null;
    old_jp_name: string | null;
    new_jp_name: string | null;
    old_jp_description: string | null;
    new_jp_description: string | null;
    has_japanese: boolean;
}

export interface ItemEditorLoadResult {
    english_source_path: string;
    japanese_source_path: string | null;
    english_output_yaml_path: string;
    english_output_dat_path: string;
    japanese_output_yaml_path: string | null;
    japanese_output_dat_path: string | null;
    rows: ItemEditorRow[];
}

export interface ZoneEditorRow {
    id: number;
    name: string;
}

export interface ZoneEditorLoadResult {
    zone_id: number;
    zone_name: string;
    source_path: string;
    output_yaml_path: string;
    output_dat_path: string;
    rows: ZoneEditorRow[];
}

export interface ZoneEditorSaveResult {
    written_count: number;
    out_yaml_path: string;
    out_dat_path: string;
}

export interface ItemEditorSaveResult {
    written_count: number;
    saved_english: boolean;
    saved_japanese: boolean;
    english_out_yaml_path: string;
    english_out_dat_path: string | null;
    japanese_out_yaml_path: string | null;
    japanese_out_dat_path: string | null;
}

export type ItemEditorSaveTarget = "both" | "english" | "japanese";

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

export interface ItemDiffRow {
    row: number;
    old_id: number | null;
    new_id: number | null;
    retail_id: number | null;
    old_stack_size: number | null;
    new_stack_size: number | null;
    retail_stack_size: number | null;
    old_level: number | null;
    new_level: number | null;
    retail_level: number | null;
    old_item_type: string | null;
    new_item_type: string | null;
    retail_item_type: string | null;
    old_shield_size: number | null;
    new_shield_size: number | null;
    retail_shield_size: number | null;
    old_max_charges: number | null;
    new_max_charges: number | null;
    retail_max_charges: number | null;
    old_casting_time: number | null;
    new_casting_time: number | null;
    retail_casting_time: number | null;
    old_use_delay: number | null;
    new_use_delay: number | null;
    retail_use_delay: number | null;
    old_reuse_delay: number | null;
    new_reuse_delay: number | null;
    retail_reuse_delay: number | null;
    old_valid_targets: string[] | null;
    new_valid_targets: string[] | null;
    retail_valid_targets: string[] | null;
    old_slots: string[] | null;
    new_slots: string[] | null;
    retail_slots: string[] | null;
    old_icon_bytes: string | null;
    new_icon_bytes: string | null;
    retail_icon_bytes: string | null;
    old_flags: string[] | null;
    new_flags: string[] | null;
    retail_flags: string[] | null;
    old_jobs: string[] | null;
    new_jobs: string[] | null;
    retail_jobs: string[] | null;
    old_en_name: string | null;
    new_en_name: string | null;
    retail_en_name: string | null;
    old_en_description: string | null;
    new_en_description: string | null;
    retail_en_description: string | null;
    old_jp_name: string | null;
    new_jp_name: string | null;
    retail_jp_name: string | null;
    old_jp_description: string | null;
    new_jp_description: string | null;
    retail_jp_description: string | null;
    has_japanese: boolean;
    has_retail_entry: boolean;
    choice: EntityDiffChoice;
}

export interface ItemDiffResult {
    rows: ItemDiffRow[];
    old_count: number;
    new_count: number;
    changed_count: number;
    old_japanese_path: string | null;
    new_japanese_path: string | null;
}

export interface EntityDiffSaveResult {
    written_count: number;
    kept_old_count: number;
    kept_new_count: number;
    out_yaml_path: string;
    out_dat_path: string | null;
}

export interface ItemDiffSaveResult {
    written_count: number;
    kept_old_count: number;
    kept_new_count: number;
    out_yaml_path: string;
    out_dat_path: string | null;
    japanese_out_yaml_path: string | null;
    japanese_out_dat_path: string | null;
}

export interface SpellDiffSaveResult {
    written_count: number;
    kept_old_count: number;
    kept_new_count: number;
    out_yaml_path: string;
    out_dat_path: string | null;
    spell_names_en_path: string | null;
    spell_names_jp_path: string | null;
    spell_descriptions_en_path: string | null;
    spell_descriptions_jp_path: string | null;
}

export interface SpellDiffRow {
    row: number;
    old_index: number | null;
    old_name: string | null;
    old_name_jp: string | null;
    old_description_en: string | null;
    old_description_jp: string | null;
    old_valid_targets: string[] | null;
    old_mp_cost: number | null;
    old_cast_time: number | null;
    old_recast_time: number | null;
    old_range: string | null;
    old_aoe_range: string | null;
    old_area_shape: string | null;
    old_valid_target_type: string | null;
    old_level_required: Record<string, number> | null;
    new_index: number | null;
    new_name: string | null;
    new_name_jp: string | null;
    new_description_en: string | null;
    new_description_jp: string | null;
    new_valid_targets: string[] | null;
    new_mp_cost: number | null;
    new_cast_time: number | null;
    new_recast_time: number | null;
    new_range: string | null;
    new_aoe_range: string | null;
    new_area_shape: string | null;
    new_valid_target_type: string | null;
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

export interface AbilityDiffSaveResult {
    written_count: number;
    kept_old_count: number;
    kept_new_count: number;
    out_yaml_path: string;
    out_dat_path: string | null;
    ability_names_en_path: string | null;
    ability_names_jp_path: string | null;
    ability_descriptions_en_path: string | null;
    ability_descriptions_jp_path: string | null;
}

export interface AbilityDiffRow {
    row: number;
    old_id: number | null;
    old_name: string | null;
    old_name_jp: string | null;
    old_description_en: string | null;
    old_description_jp: string | null;
    old_valid_targets: string[] | null;
    old_charges_required: number | null;
    old_range: string | null;
    old_aoe_range: string | null;
    old_area_shape: string | null;
    old_valid_target_type: string | null;
    new_id: number | null;
    new_name: string | null;
    new_name_jp: string | null;
    new_description_en: string | null;
    new_description_jp: string | null;
    new_valid_targets: string[] | null;
    new_charges_required: number | null;
    new_range: string | null;
    new_aoe_range: string | null;
    new_area_shape: string | null;
    new_valid_target_type: string | null;
    target_id: number | null;
    choice: EntityDiffChoice;
}

export interface AbilityDiffResult {
    rows: AbilityDiffRow[];
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

export async function loadItemEditorData(descriptor: DatDescriptor): Promise<Result<ItemEditorLoadResult, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("load_item_editor_data", { descriptor }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function loadZoneEditorData(zoneId: number): Promise<Result<ZoneEditorLoadResult, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("load_zone_editor_data", { zoneId }) };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function compareItemFiles(oldPath: string, newPath: string): Promise<Result<ItemDiffResult, any>> {
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

export async function compareAbilityFiles(oldPath: string, newPath: string): Promise<Result<AbilityDiffResult, any>> {
    try {
        return { status: "ok", data: await TAURI_INVOKE("compare_ability_files", { oldPath, newPath }) };
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
    rows: ItemDiffRow[],
    outYamlPath: string,
    outDatPath: string | null,
): Promise<Result<ItemDiffSaveResult, any>> {
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

export async function saveItemEditorData(
    descriptor: DatDescriptor,
    rows: ItemEditorRow[],
    saveTarget: ItemEditorSaveTarget = "both",
): Promise<Result<ItemEditorSaveResult, any>> {
    try {
        return {
            status: "ok",
            data: await TAURI_INVOKE("save_item_editor_data", { descriptor, rows, saveTarget }),
        };
    } catch (e) {
        if (e instanceof Error) throw e;
        else return { status: "error", error: e as any };
    }
}

export async function saveZoneEditorData(
    zoneId: number,
    rows: ZoneEditorRow[],
): Promise<Result<ZoneEditorSaveResult, any>> {
    try {
        return {
            status: "ok",
            data: await TAURI_INVOKE("save_zone_editor_data", { zoneId, rows }),
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
): Promise<Result<SpellDiffSaveResult, any>> {
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

export async function saveAbilityDiff(
    oldPath: string,
    newPath: string,
    rows: AbilityDiffRow[],
    outYamlPath: string,
    outDatPath: string | null,
): Promise<Result<AbilityDiffSaveResult, any>> {
    try {
        return {
            status: "ok",
            data: await TAURI_INVOKE("save_ability_diff", { oldPath, newPath, rows, outYamlPath, outDatPath }),
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
