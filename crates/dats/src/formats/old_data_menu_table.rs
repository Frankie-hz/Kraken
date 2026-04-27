use std::collections::BTreeMap;

use anyhow::{Result, anyhow};
use common::{byte_walker::ByteWalker, expect_msg, writing_byte_walker::WritingByteWalker};
use encoding::{decoder::Decoder, encoder::Encoder};
use serde_derive::{Deserialize, Serialize};

use crate::{
    dat_format::DatFormat,
    enums::{AbilityType, Element, JobEnum, MagicType, SkillType},
    flags::ValidTargets,
    serde_hex,
    utils::{decode_data_block, encode_data_block},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct OldDataMenuTable {
    sections: Vec<OldDataMenuSection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OldDataMenuSection {
    code: String,
    kind: u8,
    row_size: usize,
    name_offset: usize,
    entries: Vec<OldDataMenuEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OldDataMenuEntry {
    id: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    magic_type: Option<MagicType>,
    #[serde(alias = "element", skip_serializing_if = "Option::is_none")]
    menu_element: Option<Element>,
    #[serde(skip_serializing_if = "Option::is_none")]
    valid_targets: Option<ValidTargets>,
    #[serde(alias = "skill_type", skip_serializing_if = "Option::is_none")]
    menu_skill_type: Option<SkillType>,
    #[serde(alias = "icon2_id", skip_serializing_if = "Option::is_none")]
    mp_cost: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cast_time: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recast_time: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    level_required: Option<BTreeMap<JobEnum, u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_id: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ability_type: Option<AbilityType>,
    #[serde(alias = "name_marker", skip_serializing_if = "Option::is_none")]
    icon_id: Option<u8>,
    #[serde(alias = "charges_required", skip_serializing_if = "Option::is_none")]
    shared_timer_id: Option<u16>,
    #[serde(alias = "recast_id", skip_serializing_if = "Option::is_none")]
    menu_group: Option<u16>,
    #[serde(default, with = "serde_hex", skip_serializing_if = "Vec::is_empty")]
    header: Vec<u8>,
    name: String,
    #[serde(default, with = "serde_hex", skip_serializing_if = "Vec::is_empty")]
    tail: Vec<u8>,
}

impl OldDataMenuSection {
    fn parse<T: ByteWalker>(walker: &mut T, code: String, kind: u8, size: usize) -> Result<Self> {
        let (row_size, name_offset, has_name_marker) = match code.as_str() {
            "mgc_" => (64, 0x28, true),
            "comm" => (48, 0x0A, false),
            _ => return Err(anyhow!("Unsupported old data menu section: {code}")),
        };

        if size % row_size != 0 {
            return Err(anyhow!(
                "Expected {code} section size {size} to be divisible by row size {row_size}."
            ));
        }

        let entries = (0..size / row_size)
            .map(|_| OldDataMenuEntry::parse(walker, row_size, name_offset, has_name_marker))
            .collect::<Result<Vec<_>>>()?;

        Ok(Self {
            code,
            kind,
            row_size,
            name_offset,
            entries,
        })
    }

    fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        let has_name_marker = self.code == "mgc_";

        if !matches!(self.code.as_str(), "mgc_" | "comm") {
            return Err(anyhow!("Unsupported old data menu section: {}", self.code));
        }

        for entry in &self.entries {
            entry.write(walker, self.row_size, self.name_offset, has_name_marker)?;
        }

        Ok(())
    }
}

impl OldDataMenuEntry {
    fn empty(id: u16, name: String) -> Self {
        Self {
            id,
            magic_type: None,
            menu_element: None,
            valid_targets: None,
            menu_skill_type: None,
            mp_cost: None,
            cast_time: None,
            recast_time: None,
            level_required: None,
            data_id: None,
            ability_type: None,
            icon_id: None,
            shared_timer_id: None,
            menu_group: None,
            header: Vec::new(),
            name,
            tail: Vec::new(),
        }
    }

    fn parse<T: ByteWalker>(
        walker: &mut T,
        row_size: usize,
        name_offset: usize,
        has_name_marker: bool,
    ) -> Result<Self> {
        let mut row = walker.take_bytes(row_size)?.to_vec();
        decode_data_block(&mut row);

        let id = u16::from_le_bytes([row[0], row[1]]);
        let name_start = if has_name_marker {
            name_offset + 1
        } else {
            name_offset
        };
        let name_end = row[name_start..]
            .iter()
            .position(|byte| *byte == 0)
            .map(|offset| name_start + offset)
            .unwrap_or(row_size);

        let name = Decoder::decode_simple(&row[name_start..name_end])?;
        let tail_start = if name_end < row_size {
            name_end + 1
        } else {
            row_size
        };
        let tail = row[tail_start..].to_vec();
        Self::validate_padding_tail(&tail, id)?;

        let mut entry = Self::empty(id, name);
        if has_name_marker {
            entry.parse_magic_header(&row)?;
        } else {
            entry.parse_ability_header(&row);
        }

        Ok(entry)
    }

    fn write<T: WritingByteWalker>(
        &self,
        walker: &mut T,
        row_size: usize,
        name_offset: usize,
        has_name_marker: bool,
    ) -> Result<()> {
        let mut row = vec![0; row_size];
        row[row_size - 1] = 0xFF;
        write_u16(&mut row, 0, self.id);

        let name_start = if has_name_marker {
            self.write_magic_header(&mut row, name_offset)?;
            name_offset + 1
        } else {
            self.write_ability_header(&mut row, name_offset)?;
            name_offset
        };

        let name_bytes = Encoder::encode_simple(&self.name)?;
        let name_end = name_start + name_bytes.len();
        if name_end >= row_size - 1 {
            return Err(anyhow!(
                "OldDataMenuEntry name is too long for {}-byte row: {}",
                row_size,
                self.name
            ));
        }

        row[name_start..name_end].copy_from_slice(&name_bytes);

        encode_data_block(&mut row);
        walker.write_bytes(&row);

        Ok(())
    }

    fn parse_magic_header(&mut self, row: &[u8]) -> Result<()> {
        let magic_type = MagicType::from(read_u16(row, 0x02));
        self.magic_type = Some(magic_type);
        self.valid_targets = Some(ValidTargets::from_bits(read_u16(row, 0x06)).unwrap_or_default());

        if magic_type != MagicType::BlueMagic {
            self.menu_element = Some(Element::try_from(read_u16(row, 0x04))?);
            self.menu_skill_type = Some(SkillType::from(row[0x08]));
        }

        self.mp_cost = Some(read_u16(row, 0x0A));
        self.cast_time = Some(row[0x0C]);
        self.recast_time = Some(row[0x0D]);

        let mut level_required = BTreeMap::new();
        for job_id in 0..24 {
            let offset = 0x0E + job_id;
            let level = row[offset];
            if level != 0xFF {
                level_required.insert(JobEnum::from(job_id as u8), level as u16);
            }
        }
        self.level_required = Some(level_required);
        self.data_id = Some(read_u16(row, 0x26));
        self.icon_id = Some(row[0x28]);

        Ok(())
    }

    fn parse_ability_header(&mut self, row: &[u8]) {
        self.ability_type = Some(AbilityType::from(row[0x02]));
        self.icon_id = Some(row[0x03]);
        self.mp_cost = Some(read_u16(row, 0x04));
        self.shared_timer_id = Some(read_u16(row, 0x06));
        self.menu_group = Some(read_u16(row, 0x08));
    }

    fn write_magic_header(&self, row: &mut [u8], name_offset: usize) -> Result<()> {
        if self.magic_type.is_none() && !self.header.is_empty() {
            self.write_legacy_header(row, name_offset)?;
            row[name_offset] = self.icon_id.unwrap_or_default();
            return Ok(());
        }

        write_u16(
            row,
            0x02,
            (*required(&self.magic_type, "magic_type")?).into(),
        );
        let magic_type = *required(&self.magic_type, "magic_type")?;
        let element = match self.menu_element {
            Some(element) => element,
            None if magic_type == MagicType::BlueMagic => Element::Fire,
            None => {
                return Err(anyhow!(
                    "OldDataMenuEntry is missing required field menu_element."
                ));
            }
        };
        write_u16(row, 0x04, element.into());
        write_u16(
            row,
            0x06,
            required(&self.valid_targets, "valid_targets")?.bits(),
        );
        let skill_type: u8 = match self.menu_skill_type {
            Some(skill_type) => skill_type,
            None if magic_type == MagicType::BlueMagic => SkillType::HandToHand,
            None => {
                return Err(anyhow!(
                    "OldDataMenuEntry is missing required field menu_skill_type."
                ));
            }
        }
        .into();
        write_u16(row, 0x08, skill_type as u16);
        write_u16(row, 0x0A, *required(&self.mp_cost, "mp_cost")?);
        row[0x0C] = *required(&self.cast_time, "cast_time")?;
        row[0x0D] = *required(&self.recast_time, "recast_time")?;

        let level_required = required(&self.level_required, "level_required")?;
        for job_id in 0..24 {
            let offset = 0x0E + job_id;
            let job = JobEnum::from(job_id as u8);
            let level = match level_required.get(&job).copied() {
                Some(level) => u8::try_from(level).map_err(|_| {
                    anyhow!(
                        "OldDataMenuEntry level_required for {:?} must fit in one byte.",
                        job
                    )
                })?,
                None => 0xFF,
            };
            row[offset] = level;
        }

        write_u16(row, 0x26, *required(&self.data_id, "data_id")?);
        row[name_offset] = *required(&self.icon_id, "icon_id")?;

        Ok(())
    }

    fn write_ability_header(&self, row: &mut [u8], name_offset: usize) -> Result<()> {
        if self.ability_type.is_none() && !self.header.is_empty() {
            return self.write_legacy_header(row, name_offset);
        }

        row[0x02] = (*required(&self.ability_type, "ability_type")?).into();
        row[0x03] = *required(&self.icon_id, "icon_id")?;
        write_u16(row, 0x04, *required(&self.mp_cost, "mp_cost")?);
        write_u16(
            row,
            0x06,
            *required(&self.shared_timer_id, "shared_timer_id")?,
        );
        write_u16(row, 0x08, *required(&self.menu_group, "menu_group")?);

        Ok(())
    }

    fn write_legacy_header(&self, row: &mut [u8], name_offset: usize) -> Result<()> {
        let expected_header_len = name_offset - 2;
        if self.header.len() != expected_header_len {
            return Err(anyhow!(
                "OldDataMenuEntry header must be {expected_header_len} bytes, found {}.",
                self.header.len()
            ));
        }

        row[2..name_offset].copy_from_slice(&self.header);
        Self::validate_padding_tail(&self.tail, self.id)?;

        Ok(())
    }

    fn validate_padding_tail(tail: &[u8], id: u16) -> Result<()> {
        if tail.is_empty() || tail[tail.len() - 1] != 0xFF {
            return Err(anyhow!(
                "OldDataMenuEntry {id} tail must end with the 0xFF row marker."
            ));
        }

        if tail[..tail.len() - 1].iter().any(|byte| *byte != 0) {
            return Err(anyhow!(
                "OldDataMenuEntry {id} tail contains non-padding bytes: {:02X?}",
                tail
            ));
        }

        Ok(())
    }
}

fn required<'a, T>(value: &'a Option<T>, field_name: &str) -> Result<&'a T> {
    value
        .as_ref()
        .ok_or_else(|| anyhow!("OldDataMenuEntry is missing required field {field_name}."))
}

fn read_u16(row: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([row[offset], row[offset + 1]])
}

fn write_u16(row: &mut [u8], offset: usize, value: u16) {
    row[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

impl OldDataMenuTable {
    pub fn parse<T: ByteWalker>(walker: &mut T) -> Result<Self> {
        walker.expect_utf8_str("menu")?;
        walker.expect::<u32>(0x101)?;
        walker.expect_n_msg::<u8>(0, 24, "Padding after menu tag")?;

        let mut sections = Vec::new();
        loop {
            let code = String::from_utf8(walker.take_bytes(4)?.to_vec())?;
            let size_info = walker.step::<u32>()?;
            let section_size = (((size_info & 0xFFFFFF80) >> 3) - 16) as usize;
            let kind = (size_info & 0x7F) as u8;
            walker.expect_n_msg::<u8>(0, 8, "Padding after section size info")?;

            if code == "end\0" {
                if section_size != 0 {
                    return Err(anyhow!("Unexpected end section size: {section_size}"));
                }
                break;
            }

            sections.push(OldDataMenuSection::parse(walker, code, kind, section_size)?);
        }

        expect_msg(0, walker.remaining(), "End of sections")?;

        let table = Self { sections };
        table.validate_known_116_layout()?;
        Ok(table)
    }

    fn validate_known_116_layout(&self) -> Result<()> {
        let mgc = self
            .sections
            .iter()
            .find(|section| section.code == "mgc_")
            .ok_or_else(|| anyhow!("Missing mgc_ old data menu section."))?;
        let comm = self
            .sections
            .iter()
            .find(|section| section.code == "comm")
            .ok_or_else(|| anyhow!("Missing comm old data menu section."))?;

        Self::expect_entry_name(mgc, 1, "Cure")?;
        Self::expect_entry_name(mgc, 2, "Cure II")?;
        Self::expect_entry_name(comm, 2, "Weapon Abilities")?;
        Self::expect_entry_name(comm, 16, "Mighty Strikes")?;

        Ok(())
    }

    fn expect_entry_name(section: &OldDataMenuSection, index: usize, expected: &str) -> Result<()> {
        let actual = section
            .entries
            .get(index)
            .ok_or_else(|| anyhow!("Missing {} entry at index {index}.", section.code))?
            .name
            .as_str();

        if actual != expected {
            return Err(anyhow!(
                "Expected {} entry {index} to be {expected:?}, found {actual:?}.",
                section.code
            ));
        }

        Ok(())
    }

    pub fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        self.validate_known_116_layout()?;

        walker.write_str("menu");
        walker.write::<u32>(0x101);
        walker.write_bytes(&vec![0; 24]);

        for section in &self.sections {
            walker.write_str(&section.code);
            let size_info_offset = walker.offset();
            walker.skip(12);
            let start_offset = walker.offset();
            section.write(walker)?;
            let content_len = (walker.offset() - start_offset) as u32;
            let size_info = ((content_len + 16) << 3) + section.kind as u32;
            walker.write_at(size_info_offset, size_info);
        }

        walker.write_str("end\0");
        walker.write::<u32>(16 << 3);
        walker.write_bytes(&vec![0; 8]);

        Ok(())
    }
}

impl DatFormat for OldDataMenuTable {
    fn from<T: ByteWalker>(walker: &mut T) -> Result<Self> {
        Self::parse(walker)
    }

    fn check_type<T: ByteWalker>(walker: &mut T) -> Result<()> {
        let table = Self::parse(walker)?;
        table.validate_known_116_layout()
    }

    fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        self.write(walker)
    }
}
