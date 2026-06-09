use std::collections::BTreeMap;

use crate::{
    enums::{
        AreaShapeType, CommValidTargetType, Element, JobEnum, MagicType, MagicValidTargetType,
        ModifierType, SkillType, SpellDistance,
    },
    serde_base64, serde_hex, serde_hex_num,
    utils::{
        decode_data_block_masked, decode_text_block, encode_data_block_masked, encode_text_block,
    },
};
use anyhow::{Result, anyhow};
use common::{
    byte_walker::{BufferedByteWalker, ByteWalker},
    expect, expect_msg, get_padding, get_padding_16,
    vec_byte_walker::VecByteWalker,
    writing_byte_walker::WritingByteWalker,
};
use encoding::{decoder::Decoder, encoder::Encoder};
use serde_derive::{Deserialize, Serialize};

use crate::{
    dat_format::DatFormat,
    enums::AbilityType,
    flags::{JobFlag, MagicModifier, ValidTargets},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "entries")]
#[allow(non_camel_case_types)]
pub enum Section {
    Mnc2(#[serde(with = "serde_base64")] Vec<u8>),
    Mon_(#[serde(with = "serde_base64")] Vec<u8>),
    Levc(#[serde(with = "serde_base64")] Vec<u8>),
    NamesAndDescription {
        kind: u8,
        code: String,
        menu: NamesAndDescriptionSection,
    },
    Comm(Vec<AbilityInfo>),
    Mgc_(Vec<MagicInfo>),

    Unknown(u8, String, #[serde(with = "serde_base64")] Vec<u8>),
    End,
}

pub trait SectionInfo: Sized {
    fn entry_size() -> usize;
    fn parse<T: ByteWalker>(walker: &mut T) -> Result<Self>;

    fn parse_all(bytes: &[u8]) -> Result<Vec<Self>> {
        if bytes.len() % Self::entry_size() != 0 {
            return Err(anyhow!(
                "Expected byte length to be divisible by {}. Got length {}, which has a remainder of {}.",
                Self::entry_size(),
                bytes.len(),
                bytes.len() % Self::entry_size()
            ));
        }

        let mut section_walker = BufferedByteWalker::on(bytes);
        let mut entries = Vec::with_capacity(bytes.len() / Self::entry_size());
        while section_walker.remaining() > 0 {
            entries.push(Self::parse(&mut section_walker)?);
        }
        Ok(entries)
    }

    fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()>;
    fn write_all<T: WritingByteWalker>(entries: &Vec<Self>, walker: &mut T) -> Result<u32> {
        let start_offset = walker.offset();
        for entry in entries {
            entry.write(walker)?;
        }
        let len = walker.offset() - start_offset;
        Ok(len as u32)
    }
}

impl Section {
    pub fn parse<T: ByteWalker>(walker: &mut T) -> Result<Section> {
        let section_code = String::from_utf8(walker.take_bytes(4)?.to_vec())?;
        let size_info = walker.step::<u32>()?;
        let section_size = ((size_info & 0xFFFFFF80) >> 3) - 16;
        let section_kind = (size_info & 0x7F) as u8;

        walker.expect_n_msg::<u8>(0, 8, "Padding after section size info")?;

        let bytes = walker.take_bytes(section_size as usize)?;

        let section = match section_code.as_str() {
            "mnc2" => Section::Mnc2(bytes.to_vec()),
            "mon_" => Section::Mon_(bytes.to_vec()),
            "levc" => Section::Levc(bytes.to_vec()),
            "comm" => Section::Comm(AbilityInfo::parse_all(bytes)?),
            "mgc_" => Section::Mgc_(MagicInfo::parse_all(bytes)?),
            "end\0" => Section::End,
            _ => {
                if bytes.starts_with("menu    ".as_bytes()) {
                    Section::NamesAndDescription {
                        kind: section_kind,
                        code: section_code,
                        menu: NamesAndDescriptionSection::parse(bytes)?,
                    }
                } else {
                    Section::Unknown(section_kind, section_code, bytes.to_vec())
                }
            }
        };

        if section_kind != section.get_kind() {
            return Err(anyhow!(
                "Expected section kind to be {}, but found {}.",
                section.get_kind(),
                section_kind
            ));
        }

        Ok(section)
    }

    fn get_kind(&self) -> u8 {
        match self {
            Section::Mnc2(_) => 4,
            Section::Mon_(_) => 4,
            Section::Levc(_) => 4,
            Section::NamesAndDescription { kind, .. } => kind.clone(),
            Section::Comm(_) => 83,
            Section::Mgc_(_) => 73,
            Section::Unknown(code, _, _) => *code,
            Section::End => 0,
        }
    }

    fn get_section_info(&self, content_len: u32) -> u32 {
        ((content_len + 16) << 3) + self.get_kind() as u32
    }

    pub fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        match self {
            Section::Mnc2(bytes) => {
                walker.write_str("mnc2");
                walker.write(self.get_section_info(bytes.len() as u32));
                walker.skip(8);
                walker.write_bytes(&bytes);
            }
            Section::Mon_(bytes) => {
                walker.write_str("mon_");
                walker.write(self.get_section_info(bytes.len() as u32));
                walker.skip(8);
                walker.write_bytes(&bytes);
            }
            Section::Levc(bytes) => {
                walker.write_str("levc");
                walker.write(self.get_section_info(bytes.len() as u32));
                walker.skip(8);
                walker.write_bytes(&bytes);
            }
            Section::NamesAndDescription { code, menu, .. } => {
                walker.write_str(&code);
                let size_info_offset = walker.offset();
                walker.skip(12);
                let content_len = menu.write_all(walker)?;
                walker.write_at(size_info_offset, self.get_section_info(content_len));
            }
            Section::Comm(comm) => {
                walker.write_str("comm");
                let size_info_offset = walker.offset();
                walker.skip(12);
                let content_len = AbilityInfo::write_all(comm, walker)?;
                walker.write_at(size_info_offset, self.get_section_info(content_len));
            }
            Section::Mgc_(magic) => {
                walker.write_str("mgc_");
                let size_info_offset = walker.offset();
                walker.skip(12);
                let content_len = MagicInfo::write_all(magic, walker)?;
                walker.write_at(size_info_offset, self.get_section_info(content_len));
            }

            Section::Unknown(_code, section_code, bytes) => {
                walker.write_str(&section_code);
                walker.write(self.get_section_info(bytes.len() as u32));
                walker.skip(8);
                walker.write_bytes(&bytes);
            }
            Section::End => unreachable!(),
        };

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AbilityInfo {
    id: u16,
    ability_type: AbilityType,
    icon_id: u8,
    #[serde(alias = "unknown1")]
    icon2_id: u16,
    #[serde(alias = "mp_cost")]
    charges_required: u16,
    #[serde(alias = "shared_timer_id")]
    recast_id: u16,
    valid_targets: ValidTargets,
    tp_cost: i16,
    level: i8,
    range: SpellDistance,
    aoe_range: SpellDistance,
    area_shape: AreaShapeType,
    valid_target_type: CommValidTargetType,
    tp_modifier: ModifierType,
    tp_modifier_values: Vec<i16>,
    #[serde(default)]
    unknown_0e: u8,
    #[serde(default)]
    unknown_1c: i16,
    #[serde(default)]
    unknown_1e: i16,
    #[serde(default)]
    unknown_20: u8,
    #[serde(default)]
    unknown_21: u8,
    #[serde(default)]
    unknown_22: i16,
    #[serde(default)]
    unknown_24: u8,
    #[serde(default, with = "serde_hex")]
    unknowns: Vec<u8>,
    #[serde(default, skip_serializing)]
    unknown_25: u8,
    #[serde(default, skip_serializing)]
    unknown_26: u8,
    #[serde(default, skip_serializing)]
    unknown_27: u8,
    #[serde(default, skip_serializing)]
    unknown_28: u8,
    #[serde(default, skip_serializing)]
    unknown_29: u8,
    #[serde(default, skip_serializing)]
    unknown_2a: u8,
    #[serde(default, skip_serializing)]
    unknown_2b: u8,
    #[serde(default, skip_serializing)]
    unknown_2c: u8,
    #[serde(default, skip_serializing)]
    unknown_2d: u8,
    #[serde(default, skip_serializing)]
    unknown_2e: u8,
}

const ABILITY_UNKNOWNS_LEN: usize = 20;
const ABILITY_TRAILING_UNKNOWNS_LEN: usize = 10;

impl AbilityInfo {
    fn unknown_prefix_from_parts(
        unknown_0e: u8,
        unknown_1c: i16,
        unknown_1e: i16,
        unknown_20: u8,
        unknown_21: u8,
        unknown_22: i16,
        unknown_24: u8,
    ) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(ABILITY_UNKNOWNS_LEN - ABILITY_TRAILING_UNKNOWNS_LEN);
        bytes.push(unknown_0e);
        bytes.extend_from_slice(&unknown_1c.to_le_bytes());
        bytes.extend_from_slice(&unknown_1e.to_le_bytes());
        bytes.push(unknown_20);
        bytes.push(unknown_21);
        bytes.extend_from_slice(&unknown_22.to_le_bytes());
        bytes.push(unknown_24);
        bytes
    }

    fn unknown_tail_from_parts(
        unknown_25: u8,
        unknown_26: u8,
        unknown_27: u8,
        unknown_28: u8,
        unknown_29: u8,
        unknown_2a: u8,
        unknown_2b: u8,
        unknown_2c: u8,
        unknown_2d: u8,
        unknown_2e: u8,
    ) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(ABILITY_TRAILING_UNKNOWNS_LEN);
        bytes.push(unknown_25);
        bytes.push(unknown_26);
        bytes.push(unknown_27);
        bytes.push(unknown_28);
        bytes.push(unknown_29);
        bytes.push(unknown_2a);
        bytes.push(unknown_2b);
        bytes.push(unknown_2c);
        bytes.push(unknown_2d);
        bytes.push(unknown_2e);
        bytes
    }

    fn unknown_prefix(&self) -> Vec<u8> {
        Self::unknown_prefix_from_parts(
            self.unknown_0e,
            self.unknown_1c,
            self.unknown_1e,
            self.unknown_20,
            self.unknown_21,
            self.unknown_22,
            self.unknown_24,
        )
    }

    fn legacy_unknown_tail(&self) -> Vec<u8> {
        Self::unknown_tail_from_parts(
            self.unknown_25,
            self.unknown_26,
            self.unknown_27,
            self.unknown_28,
            self.unknown_29,
            self.unknown_2a,
            self.unknown_2b,
            self.unknown_2c,
            self.unknown_2d,
            self.unknown_2e,
        )
    }

    fn normalized_unknown_tail(&self) -> Result<Vec<u8>> {
        if self.unknowns.is_empty() {
            return Ok(self.legacy_unknown_tail());
        }

        if self.unknowns.len() == ABILITY_UNKNOWNS_LEN {
            return Ok(
                self.unknowns[ABILITY_UNKNOWNS_LEN - ABILITY_TRAILING_UNKNOWNS_LEN..].to_vec(),
            );
        }

        if self.unknowns.len() != ABILITY_TRAILING_UNKNOWNS_LEN {
            return Err(anyhow!(
                "AbilityInfo unknowns must be {} trailing bytes, found {}",
                ABILITY_TRAILING_UNKNOWNS_LEN,
                self.unknowns.len()
            ));
        }

        Ok(self.unknowns.clone())
    }

    fn normalized_unknowns(&self) -> Result<Vec<u8>> {
        if self.unknowns.len() == ABILITY_UNKNOWNS_LEN {
            return Ok(self.unknowns.clone());
        }

        let mut unknowns = self.unknown_prefix();
        unknowns.extend_from_slice(&self.normalized_unknown_tail()?);
        Ok(unknowns)
    }
}

impl SectionInfo for AbilityInfo {
    #[inline]
    fn entry_size() -> usize {
        48
    }

    fn parse<T: ByteWalker>(walker: &mut T) -> Result<AbilityInfo> {
        let mut data_bytes = walker.take_bytes(Self::entry_size())?.to_vec();
        decode_data_block_masked(&mut data_bytes);
        let mut data_walker = BufferedByteWalker::on(data_bytes);

        let id = data_walker.step::<u16>()?;
        let ability_type = AbilityType::from(data_walker.step::<u8>()?);
        let icon_id = data_walker.step::<u8>()?;
        let icon2_id = data_walker.step::<u16>()?;
        let charges_required = data_walker.step::<u16>()?;
        let recast_id = data_walker.step::<u16>()?;
        let valid_targets = ValidTargets::from_bits(data_walker.step::<u16>()?).unwrap_or_default();
        let tp_cost = data_walker.step::<i16>()?;
        let unknown_0e = data_walker.step::<u8>()?;
        let level = data_walker.step::<u8>()? as i8;
        let range = SpellDistance::from(data_walker.step::<u8>()?);
        let aoe_range = SpellDistance::from(data_walker.step::<u8>()?);
        let area_shape = AreaShapeType::from(data_walker.step::<u8>()?);
        let valid_target_type = CommValidTargetType::from(data_walker.step::<u16>()?);
        let tp_modifier = ModifierType::from(data_walker.step::<u8>()? as i8);
        let tp_modifier_values = (0..3)
            .map(|_| data_walker.step::<i16>())
            .collect::<Result<Vec<_>>>()?;
        let unknown_1c = data_walker.step::<i16>()?;
        let unknown_1e = data_walker.step::<i16>()?;
        let unknown_20 = data_walker.step::<u8>()?;
        let unknown_21 = data_walker.step::<u8>()?;
        let unknown_22 = data_walker.step::<i16>()?;
        let unknown_24 = data_walker.step::<u8>()?;
        let unknown_25 = data_walker.step::<u8>()?;
        let unknown_26 = data_walker.step::<u8>()?;
        let unknown_27 = data_walker.step::<u8>()?;
        let unknown_28 = data_walker.step::<u8>()?;
        let unknown_29 = data_walker.step::<u8>()?;
        let unknown_2a = data_walker.step::<u8>()?;
        let unknown_2b = data_walker.step::<u8>()?;
        let unknown_2c = data_walker.step::<u8>()?;
        let unknown_2d = data_walker.step::<u8>()?;
        let unknown_2e = data_walker.step::<u8>()?;

        let info = AbilityInfo {
            id,
            ability_type,
            icon_id,
            icon2_id,
            charges_required,
            recast_id,
            valid_targets,
            tp_cost,
            level,
            range,
            aoe_range,
            area_shape,
            valid_target_type,
            tp_modifier,
            tp_modifier_values,
            unknown_0e,
            unknown_1c,
            unknown_1e,
            unknown_20,
            unknown_21,
            unknown_22,
            unknown_24,
            unknowns: AbilityInfo::unknown_tail_from_parts(
                unknown_25, unknown_26, unknown_27, unknown_28, unknown_29, unknown_2a, unknown_2b,
                unknown_2c, unknown_2d, unknown_2e,
            ),
            unknown_25,
            unknown_26,
            unknown_27,
            unknown_28,
            unknown_29,
            unknown_2a,
            unknown_2b,
            unknown_2c,
            unknown_2d,
            unknown_2e,
        };

        data_walker.expect_msg::<u8>(0xFF, "End of ability marker")?;

        Ok(info)
    }

    fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        let mut data_walker = VecByteWalker::with_size(Self::entry_size());
        let unknowns = self.normalized_unknowns()?;

        data_walker.write(self.id);
        data_walker.write::<u8>(self.ability_type.into());
        data_walker.write(self.icon_id);
        data_walker.write(self.icon2_id);
        data_walker.write(self.charges_required);
        data_walker.write(self.recast_id);
        data_walker.write(self.valid_targets.bits());
        data_walker.write(self.tp_cost);
        data_walker.write(unknowns[0]);
        data_walker.write(self.level as u8);
        data_walker.write::<u8>(self.range.into());
        data_walker.write::<u8>(self.aoe_range.into());
        data_walker.write::<u8>(self.area_shape.into());
        data_walker.write::<u16>(self.valid_target_type.into());
        data_walker.write::<u8>(i8::from(self.tp_modifier) as u8);
        if self.tp_modifier_values.len() != 3 {
            return Err(anyhow!(
                "AbilityInfo tp_modifier_values must contain 3 values, found {}",
                self.tp_modifier_values.len()
            ));
        }
        for tp_modifier_value in &self.tp_modifier_values {
            data_walker.write(*tp_modifier_value);
        }
        data_walker.write_bytes(&unknowns[1..]);

        data_walker.write::<u8>(0xFF);

        encode_data_block_masked(data_walker.as_mut_slice());

        walker.write_bytes(data_walker.as_slice());

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MagicInfo {
    index: u16,
    magic_type: MagicType,
    element: Element,
    valid_targets: ValidTargets,
    skill_type: SkillType,
    mp_cost: u16,
    cast_time: u8,
    recast_time: u8,
    level_required: BTreeMap<JobEnum, u16>,
    id: u16,
    icon_id: u16,
    unknown_0x42: u16,
    modifiers: MagicModifier,
    range: SpellDistance,
    aoe_range: SpellDistance,
    area_shape: AreaShapeType,
    valid_target_type: MagicValidTargetType,
    #[serde(with = "serde_hex_num")]
    modifiers_ex: u32,
    gifts_required: JobFlag,
    #[serde(with = "serde_hex")]
    unknowns: Vec<u8>,
}

impl SectionInfo for MagicInfo {
    #[inline]
    fn entry_size() -> usize {
        100
    }

    fn parse<T: ByteWalker>(walker: &mut T) -> Result<MagicInfo> {
        let mut data_bytes = walker.take_bytes(Self::entry_size())?.to_vec();
        decode_data_block_masked(&mut data_bytes);
        let mut data_walker = BufferedByteWalker::on(data_bytes);

        let mut info = MagicInfo {
            index: data_walker.step::<u16>()?,
            magic_type: MagicType::from(data_walker.step::<u16>()?),
            element: Element::try_from(data_walker.step::<u16>()?)?,
            valid_targets: ValidTargets::from_bits(data_walker.step::<u16>()?).unwrap_or_default(),
            skill_type: SkillType::from(data_walker.step::<u16>()? as u8),
            mp_cost: data_walker.step()?,
            cast_time: data_walker.step()?,
            recast_time: data_walker.step()?,
            level_required: (0..24)
                .into_iter()
                .filter_map(|idx| {
                    let level = data_walker.step::<i16>().ok()?;
                    if level != -1 {
                        Some((JobEnum::from(idx), level as u16))
                    } else {
                        None
                    }
                })
                .collect(),
            id: data_walker.step()?,
            icon_id: data_walker.step()?,
            unknown_0x42: data_walker.step()?,
            modifiers: MagicModifier::from_bits_retain(data_walker.step::<u8>()?),
            range: SpellDistance::from(data_walker.step::<u8>()?),
            aoe_range: SpellDistance::from(data_walker.step::<u8>()?),
            area_shape: AreaShapeType::from(data_walker.step::<u8>()?),
            valid_target_type: MagicValidTargetType::from(data_walker.step::<u32>()?),
            modifiers_ex: data_walker.step()?,
            unknowns: data_walker.take_bytes(12)?.to_vec(),
            gifts_required: JobFlag::from_bits_retain(data_walker.step::<u32>()?),
        };

        info.unknowns.extend_from_slice(data_walker.take_bytes(3)?);
        data_walker.expect_msg::<u8>(0xFF, "End of magic marker")?;

        Ok(info)
    }

    fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        let mut data_walker = VecByteWalker::with_size(Self::entry_size());

        data_walker.write(self.index);
        data_walker.write::<u16>(self.magic_type.into());
        data_walker.write::<u16>(self.element.into());
        data_walker.write::<u16>(self.valid_targets.bits());

        let skill_type: u8 = self.skill_type.into();
        data_walker.write::<u16>(skill_type as u16);
        data_walker.write(self.mp_cost);
        data_walker.write(self.cast_time);
        data_walker.write(self.recast_time);

        for job_idx in 0..24 {
            let job = JobEnum::from(job_idx);
            let level_required = self
                .level_required
                .get(&job)
                .copied()
                .map(|level| level as i16)
                .unwrap_or(-1);

            data_walker.write(level_required);
        }

        data_walker.write(self.id);
        data_walker.write(self.icon_id);
        data_walker.write(self.unknown_0x42);
        data_walker.write(self.modifiers.bits());
        data_walker.write::<u8>(self.range.into());
        data_walker.write::<u8>(self.aoe_range.into());
        data_walker.write::<u8>(self.area_shape.into());
        data_walker.write::<u32>(self.valid_target_type.into());
        data_walker.write(self.modifiers_ex);
        if self.unknowns.len() != 15 {
            return Err(anyhow!(
                "MagicInfo unknowns must be 15 bytes, found {}",
                self.unknowns.len()
            ));
        }

        data_walker.write_bytes(&self.unknowns[..12]);
        data_walker.write(self.gifts_required.bits());
        data_walker.write_bytes(&self.unknowns[12..]);

        data_walker.write::<u8>(0xFF);

        encode_data_block_masked(data_walker.as_mut_slice());

        walker.write_bytes(data_walker.as_slice());

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MonInfo {
    #[serde(with = "serde_hex")]
    unknowns: Vec<u8>,
}

impl SectionInfo for MonInfo {
    #[inline]
    fn entry_size() -> usize {
        64
    }

    fn parse<T: ByteWalker>(walker: &mut T) -> Result<MonInfo> {
        let data_bytes = walker.take_bytes(Self::entry_size())?.to_vec();
        let mut data_walker = BufferedByteWalker::on(data_bytes);

        let info = MonInfo {
            unknowns: data_walker.take_bytes(data_walker.remaining())?.to_vec(),
        };

        Ok(info)
    }

    fn write<T: WritingByteWalker>(&self, _walker: &mut T) -> Result<()> {
        todo!()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NamesAndDescriptionSection {
    category: String,
    entries: Vec<NamesAndDescription>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NamesAndDescription {
    id: u32,
    name1: String,
    name2: String,
    description: Vec<String>,
    note: Vec<String>,
}

impl NamesAndDescriptionSection {
    fn parse(bytes: &[u8]) -> Result<NamesAndDescriptionSection> {
        let mut walker = BufferedByteWalker::on(bytes);
        walker.expect_utf8_str("menu    ")?;
        let category = walker.take_str_utf8_nul_end(8)?;
        walker.expect::<u32>(0)?;

        let entry_count = walker.step::<u32>()?;

        let mut entries_meta = (0..entry_count)
            .map(|_| NamesAndDescriptionMeta::parse(&mut walker))
            .collect::<Result<Vec<_>>>()?;

        for meta in entries_meta.iter_mut() {
            expect(walker.offset() as u32, meta.desc_lines_meta_offset)?;
            meta.desc_lines_offsets = Self::parse_lines_meta(&mut walker)?;

            expect(walker.offset() as u32, meta.note_lines_meta_offset)?;
            meta.note_lines_offsets = Self::parse_lines_meta(&mut walker)?;
        }

        let mut entries = Vec::with_capacity(entry_count as usize);
        for meta in entries_meta {
            expect(walker.offset() as u32, meta.name1_offset)?;
            let name1 = Self::decode_text(&mut walker)?;

            expect(walker.offset() as u32, meta.name2_offset)?;
            let name2 = Self::decode_text(&mut walker)?;

            let mut desc_lines = Vec::with_capacity(meta.desc_lines_offsets.len());
            for line_offset in meta.desc_lines_offsets {
                expect(walker.offset() as u32, line_offset)?;
                let line = Self::decode_text(&mut walker)?;
                desc_lines.push(line);
            }

            let mut note_lines = Vec::with_capacity(meta.note_lines_offsets.len());
            for line_offset in meta.note_lines_offsets {
                expect(walker.offset() as u32, line_offset)?;
                let line = Self::decode_text(&mut walker)?;
                note_lines.push(line);
            }

            entries.push(NamesAndDescription {
                id: meta.id,
                name1,
                name2,
                description: desc_lines,
                note: note_lines,
            });
        }

        walker.skip(get_padding_16(walker.offset()));
        expect_msg(
            0,
            walker.remaining(),
            format!(
                "Some bytes in section have not been parsed (total size: {})",
                bytes.len()
            ),
        )?;

        Ok(NamesAndDescriptionSection { category, entries })
    }

    fn parse_lines_meta<T: ByteWalker>(walker: &mut T) -> Result<Vec<u32>> {
        let line_count = walker.step::<u32>()?;
        (0..line_count).map(|_| walker.step::<u32>()).collect()
    }

    fn decode_text<T: ByteWalker>(walker: &mut T) -> Result<String> {
        let mut text_bytes = walker.step_until(0)?.to_vec();
        if text_bytes.len() < 2 {
            text_bytes.push(walker.step::<u8>()?);
        }
        decode_text_block(&mut text_bytes);

        let read_length = text_bytes.len() + 1;
        walker.expect::<u8>(0)?;

        // Alignment padding
        let padding = get_padding(read_length);
        walker.expect_n_msg::<u8>(0, padding, "Alignment padding")?;

        Ok(Decoder::decode_simple(&text_bytes)?)
    }

    fn write_all<T: WritingByteWalker>(&self, walker: &mut T) -> Result<u32> {
        let start_offset = walker.offset() as u32;

        walker.write_str("menu    ");
        walker.write_str(&self.category);
        walker.write::<u32>(0);

        walker.write::<u32>(self.entries.len() as u32);

        let metadata_size = self.entries.len() * 20; // 20 bytes per entry for metadata
        let mut lines_meta_size = self.entries.len() * 8; // 4 bytes for each line count of description and note data

        for entry in &self.entries {
            // Each line has a 4 byte offset value
            lines_meta_size += entry.description.len() * 4;
            lines_meta_size += entry.note.len() * 4;
        }

        let mut current_metadata_offset = walker.offset();
        let mut current_lines_meta_offset = current_metadata_offset + metadata_size;

        walker.skip(metadata_size + lines_meta_size);

        for entry in &self.entries {
            // Id metadata
            walker.write_at::<u32>(current_metadata_offset, entry.id);
            current_metadata_offset += 4;

            // Name1
            walker.write_at::<u32>(
                current_metadata_offset,
                walker.offset() as u32 - start_offset,
            );
            current_metadata_offset += 4;
            Self::encode_text(walker, &entry.name1)?;

            // Name2
            walker.write_at::<u32>(
                current_metadata_offset,
                walker.offset() as u32 - start_offset,
            );
            current_metadata_offset += 4;
            Self::encode_text(walker, &entry.name2)?;

            // Description - Lines meta offset
            walker.write_at::<u32>(
                current_metadata_offset,
                current_lines_meta_offset as u32 - start_offset,
            );
            current_metadata_offset += 4;

            // Description - Line count
            walker.write_at::<u32>(current_lines_meta_offset, entry.description.len() as u32);
            current_lines_meta_offset += 4;

            for line in &entry.description {
                // Line offset
                walker.write_at::<u32>(
                    current_lines_meta_offset,
                    walker.offset() as u32 - start_offset,
                );
                current_lines_meta_offset += 4;

                Self::encode_text(walker, line)?;
            }

            // Note - Lines meta offset
            walker.write_at::<u32>(
                current_metadata_offset,
                current_lines_meta_offset as u32 - start_offset,
            );
            current_metadata_offset += 4;

            // Note - Line count
            walker.write_at::<u32>(current_lines_meta_offset, entry.note.len() as u32);
            current_lines_meta_offset += 4;

            for line in &entry.note {
                // Line offset
                walker.write_at::<u32>(
                    current_lines_meta_offset,
                    walker.offset() as u32 - start_offset,
                );
                current_lines_meta_offset += 4;

                Self::encode_text(walker, line)?;
            }
        }

        walker.skip(get_padding_16(walker.offset() - start_offset as usize));

        Ok(walker.offset() as u32 - start_offset)
    }

    fn encode_text<T: WritingByteWalker>(walker: &mut T, text: &str) -> Result<()> {
        let text = if text.len() < 2 {
            text.to_owned() + &"\0"
        } else {
            text.to_owned()
        };

        let mut text_bytes = Encoder::encode_simple(&text)?;

        encode_text_block(&mut text_bytes);

        let write_length = text_bytes.len() + 1;
        walker.write_bytes(&text_bytes);
        walker.write::<u8>(0);

        // Alignment padding
        let padding = get_padding(write_length);
        walker.skip(padding);

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NamesAndDescriptionMeta {
    id: u32,
    name1_offset: u32,
    name2_offset: u32,
    desc_lines_meta_offset: u32,
    desc_lines_offsets: Vec<u32>,
    note_lines_meta_offset: u32,
    note_lines_offsets: Vec<u32>,
}

impl NamesAndDescriptionMeta {
    fn parse<T: ByteWalker>(walker: &mut T) -> Result<NamesAndDescriptionMeta> {
        let id = walker.step::<u32>()?;
        let name1_offset = walker.step::<u32>()?;
        let name2_offset = walker.step::<u32>()?;
        let desc_lines_meta_offset = walker.step::<u32>()?;
        let note_lines_meta_offset = walker.step::<u32>()?;

        Ok(NamesAndDescriptionMeta {
            id,
            name1_offset,
            name2_offset,
            desc_lines_meta_offset,
            desc_lines_offsets: vec![],
            note_lines_meta_offset,
            note_lines_offsets: vec![],
        })
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct MenuTable {
    sections: Vec<Section>,
}

impl MenuTable {
    pub fn parse<T: ByteWalker>(walker: &mut T) -> Result<Self> {
        walker.expect_utf8_str("menu")?;
        walker.expect::<u32>(0x101)?;
        walker.expect_n_msg::<u8>(0, 24, "Padding after menu tag")?;

        let mut sections = vec![];
        loop {
            let section = Section::parse(walker)?;
            if matches!(section, Section::End) {
                break;
            }
            sections.push(section);
        }

        expect_msg(0, walker.remaining(), "End of sections")?;

        Ok(MenuTable { sections })
    }

    pub fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        walker.write_str("menu");
        walker.write::<u32>(0x101);
        walker.write_bytes(&vec![0; 24]);

        for section in &self.sections {
            section.write(walker)?;
        }

        walker.write_str("end\0");
        walker.write::<u32>(16 << 3);
        walker.write_bytes(&vec![0; 8]);

        Ok(())
    }
}

impl DatFormat for MenuTable {
    fn from<T: ByteWalker>(walker: &mut T) -> Result<Self> {
        MenuTable::parse(walker)
    }

    fn check_type<T: ByteWalker>(walker: &mut T) -> Result<()> {
        walker.expect_utf8_str("menu")?;

        Ok(())
    }

    fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        self.write(walker)
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use crate::{
        dat_format::DatFormat,
        enums::{
            AbilityType, AreaShapeType, CommValidTargetType, Element, JobEnum, MagicType,
            MagicValidTargetType, ModifierType, SkillType, SpellDistance,
        },
        flags::{JobFlag, MagicModifier, ValidTargets},
        formats::menu_table::Section,
    };

    use super::{AbilityInfo, MenuTable};

    #[test]
    pub fn menu_table() {
        let mut dat_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dat_path.push("resources/test/menu.DAT");

        MenuTable::check_path(&dat_path).unwrap();
        let res = MenuTable::from_path_checked_yaml(&dat_path).unwrap();

        // Validate quest info
        let magic = res.sections.get(3).unwrap();
        let magic_infos = match magic {
            Section::Mgc_(magic_info) => magic_info,
            _ => {
                unreachable!("expected magic section");
            }
        };

        let spell = magic_infos.get(14).unwrap();

        assert_eq!(spell.index, 14);
        assert_eq!(spell.magic_type, MagicType::WhiteMagic);
        assert_eq!(spell.element, Element::Light);
        assert_eq!(
            spell.valid_targets,
            ValidTargets::SelfTarget
                | ValidTargets::PartyMember
                | ValidTargets::Ally
                | ValidTargets::NPC
        );
        assert_eq!(spell.skill_type, SkillType::HealingMagic);
        assert_eq!(spell.mp_cost, 8);
        assert_eq!(spell.cast_time, 4);
        assert_eq!(spell.recast_time, 20);
        assert_eq!(
            spell.level_required,
            [(JobEnum::WHM, 6), (JobEnum::SCH, 10), (JobEnum::MON, 6)]
                .into_iter()
                .collect()
        );
        assert_eq!(spell.icon_id, 6);
        assert_eq!(spell.unknown_0x42, 114);
        assert_eq!(
            spell.modifiers,
            MagicModifier::Accession | MagicModifier::Addendum
        );
        assert_eq!(spell.range, SpellDistance::D20);
        assert_eq!(spell.aoe_range, SpellDistance::None);
        assert_eq!(spell.area_shape, AreaShapeType::Single);
        assert_eq!(spell.valid_target_type, MagicValidTargetType::Pc);
        assert_eq!(spell.modifiers_ex, 0x02800201);
        assert_eq!(spell.gifts_required, JobFlag::empty());
        assert_eq!(
            spell.unknowns,
            vec![4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );

        let spell_yaml = serde_yaml::to_string(spell).unwrap();
        assert!(!spell_yaml.contains("name:"));
        assert!(spell_yaml.contains("unknown_0x42: 114"));
        assert!(spell_yaml.contains("modifiers:"));
        assert!(spell_yaml.contains("range: D20"));
        assert!(spell_yaml.contains("aoe_range: None"));
        assert!(spell_yaml.contains("area_shape: Single"));
        assert!(spell_yaml.contains("valid_target_type: Pc"));
        assert!(spell_yaml.contains("modifiers_ex: '0x01028002'"));
        assert!(spell_yaml.contains("gifts_required: []"));
        assert!(spell_yaml.contains("unknowns: '0x040001000000000000000000000000'"));
        assert!(!spell_yaml.contains("unknown50:"));
        assert!(!spell_yaml.contains("unknown54:"));
        assert!(!spell_yaml.contains("unknown58:"));
        assert!(!spell_yaml.contains("unknown60:"));

        let comm = res.sections.get(4).unwrap();
        let ability_infos = match comm {
            Section::Comm(ability_info) => ability_info,
            _ => {
                unreachable!("expected ability section");
            }
        };

        let ability = ability_infos.get(6).unwrap();

        assert_eq!(ability.id, 6);
        assert_eq!(ability.ability_type, AbilityType::Weapon);
        assert_eq!(ability.icon_id, 46);
        assert_eq!(ability.icon2_id, 590);
        assert_eq!(ability.charges_required, 0);
        assert_eq!(ability.recast_id, 900);
        assert_eq!(ability.valid_targets, ValidTargets::Enemy);
        assert_eq!(ability.tp_cost, -1);
        assert_eq!(ability.level, 0);
        assert_eq!(ability.range, SpellDistance::D3);
        assert_eq!(ability.aoe_range, SpellDistance::D4);
        assert_eq!(ability.area_shape, AreaShapeType::Sphere);
        assert_eq!(ability.valid_target_type, CommValidTargetType::MobAoe);
        assert_eq!(ability.tp_modifier, ModifierType::RadiusOrNone);
        assert_eq!(ability.tp_modifier_values, vec![0, 48, 96]);
        assert_eq!(ability.unknown_0e, 0);
        assert_eq!(ability.unknown_1c, 0);
        assert_eq!(ability.unknown_1e, 0);
        assert_eq!(ability.unknown_20, 0);
        assert_eq!(ability.unknown_21, 0);
        assert_eq!(ability.unknown_22, 0);
        assert_eq!(ability.unknown_24, 0);
        assert_eq!(ability.unknown_25, 0);
        assert_eq!(ability.unknown_26, 0);
        assert_eq!(ability.unknown_27, 0);
        assert_eq!(ability.unknown_28, 0);
        assert_eq!(ability.unknown_29, 0);
        assert_eq!(ability.unknown_2a, 0);
        assert_eq!(ability.unknown_2b, 0);
        assert_eq!(ability.unknown_2c, 0);
        assert_eq!(ability.unknown_2d, 0);
        assert_eq!(ability.unknown_2e, 0);
        assert_eq!(ability.unknowns, vec![0; 10]);

        let ability_yaml = serde_yaml::to_string(ability).unwrap();
        assert!(!ability_yaml.contains("name:"));
        assert!(ability_yaml.contains("icon2_id: 590"));
        assert!(ability_yaml.contains("charges_required: 0"));
        assert!(ability_yaml.contains("recast_id: 900"));
        assert!(ability_yaml.contains("level: 0"));
        assert!(ability_yaml.contains("range: D3"));
        assert!(ability_yaml.contains("aoe_range: D4"));
        assert!(ability_yaml.contains("area_shape: Sphere"));
        assert!(ability_yaml.contains("valid_target_type: MobAoe"));
        assert!(ability_yaml.contains("tp_modifier: RadiusOrNone"));
        assert!(ability_yaml.contains("tp_modifier_values:"));
        assert!(ability_yaml.contains("unknown_0e: 0"));
        assert!(ability_yaml.contains("unknown_1c: 0"));
        assert!(ability_yaml.contains("unknown_1e: 0"));
        assert!(ability_yaml.contains("unknown_20: 0"));
        assert!(ability_yaml.contains("unknown_21: 0"));
        assert!(ability_yaml.contains("unknown_22: 0"));
        assert!(ability_yaml.contains("unknown_24: 0"));
        assert!(ability_yaml.contains("unknowns: '0x00000000000000000000'"));
        assert!(!ability_yaml.contains("unknown_25:"));
        assert!(!ability_yaml.contains("unknown_2e:"));
        assert!(!ability_yaml.contains("mp_cost:"));
        assert!(!ability_yaml.contains("unknown1:"));
        assert!(!ability_yaml.contains("shared_timer_id:"));

        let legacy_ability_yaml = ability_yaml
            .replace("unknown_0e: 0", "unknown_0e: 1")
            .replace("unknown_1c: 0", "unknown_1c: 515")
            .replace("unknown_1e: 0", "unknown_1e: -2")
            .replace("unknown_20: 0", "unknown_20: 4")
            .replace("unknown_21: 0", "unknown_21: 5")
            .replace("unknown_22: 0", "unknown_22: 1541")
            .replace("unknown_24: 0", "unknown_24: 7")
            .replace(
                "unknowns: '0x00000000000000000000'",
                "unknown_25: 8\nunknown_26: 9\nunknown_27: 10\nunknown_28: 11\nunknown_29: 12\nunknown_2a: 13\nunknown_2b: 14\nunknown_2c: 15\nunknown_2d: 16\nunknown_2e: 17",
            );
        let legacy_ability: AbilityInfo = serde_yaml::from_str(&legacy_ability_yaml).unwrap();
        assert!(legacy_ability.unknowns.is_empty());
        assert_eq!(
            legacy_ability.normalized_unknowns().unwrap(),
            vec![
                1, 3, 2, 254, 255, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17
            ]
        );

        let full_combined_ability_yaml = ability_yaml.replace(
            "unknowns: '0x00000000000000000000'",
            "unknowns: '0x010302feff040505060708090a0b0c0d0e0f1011'",
        );
        let full_combined_ability: AbilityInfo =
            serde_yaml::from_str(&full_combined_ability_yaml).unwrap();
        assert_eq!(
            full_combined_ability.normalized_unknowns().unwrap(),
            vec![
                1, 3, 2, 254, 255, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17
            ]
        );

        assert_eq!(res.to_bytes().unwrap(), fs::read(&dat_path).unwrap());
    }

    #[test]
    pub fn quest_mission_keyitems() {
        let mut dat_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dat_path.push("resources/test/quests_missions_keyitems.DAT");

        MenuTable::check_path(&dat_path).unwrap();
        let res = MenuTable::from_path_checked_yaml(&dat_path).unwrap();

        // Validate quest info
        let windurst_quests = res.sections.get(5).unwrap();
        let menu = match windurst_quests {
            Section::NamesAndDescription { code, menu, .. } => {
                assert_eq!(code, "ws_q");
                menu
            }
            _ => {
                unreachable!("expected names and description section");
            }
        };

        let quest = menu.entries.get(29).unwrap();

        assert_eq!(quest.id, 63);
        assert_eq!(quest.name1, "Curses, Foiled A-Golem!?");
        assert_eq!(quest.name2, "WS Quest 63");
        assert_eq!(quest.description.len(), 10);
        assert_eq!(quest.note.len(), 1);
        assert_eq!(quest.note[0], "quest");

        // Validate key item info
        let key_items = res.sections.get(14).unwrap();
        let menu = match key_items {
            Section::NamesAndDescription { code, menu, .. } => {
                assert_eq!(code, "sc_i");
                menu
            }
            _ => {
                unreachable!("expected names and description section");
            }
        };

        let key_item = menu.entries.get(761).unwrap();

        assert_eq!(key_item.id, 850);
        assert_eq!(key_item.name1, "a");
        assert_eq!(key_item.name2, "story of a diligent chocobo");
        assert_eq!(key_item.description.len(), 10);
        assert_eq!(key_item.note.len(), 1);
        assert_eq!(key_item.note[0], " ");
    }
}
