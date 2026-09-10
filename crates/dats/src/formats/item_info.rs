use anyhow::{Ok, Result, anyhow};
use common::{
    byte_walker::{BufferedByteWalker, ByteWalker},
    get_padding,
    vec_byte_walker::VecByteWalker,
    writing_byte_walker::WritingByteWalker,
};
use encoding::{decoder::Decoder, encoder::Encoder};
use serde_derive::{Deserialize, Serialize};

use crate::{
    dat_format::DatFormat,
    enums::{Element, EnglishArticle, ItemType, PuppetSlot, SkillType},
    flags::{EquipmentSlot, ItemFlag, JobFlag, Race, ValidTargets},
    serde_base64,
    utils::{get_nibble, rotate_all},
};

/// Retail switched item records from 0xC00 to 0x1400 bytes and widened a few fields with
/// zero padding. `Legacy` is the pre-change layout, `Extended` is the current retail one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ItemInfoLayout {
    Legacy,
    #[default]
    Extended,
}

impl ItemInfoLayout {
    const CANDIDATES: [ItemInfoLayout; 2] = [ItemInfoLayout::Extended, ItemInfoLayout::Legacy];

    pub const fn entry_size(self) -> usize {
        match self {
            ItemInfoLayout::Legacy => 0xC00,
            ItemInfoLayout::Extended => 0x1400,
        }
    }

    const fn is_extended(self) -> bool {
        matches!(self, ItemInfoLayout::Extended)
    }
}

const DATA_SIZE: usize = 0x280;

#[derive(Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ItemInfo {
    id: u32,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    strings: Option<ItemStrings>,

    flags: ItemFlag,
    stack_size: u16,
    item_type: ItemType,
    resource_id: u16,
    valid_targets: ValidTargets,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    equipment: Option<EquipmentData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    weapon: Option<WeaponData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    puppet: Option<PuppetItemData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    instinct: Option<InstinctData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    furnishing: Option<FurnishingData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    usable_item: Option<UsableItemData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    currency: Option<CurrencyData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    slip: Option<SlipData>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    monipulator: Option<MonipulatorData>,

    #[serde(with = "serde_base64")]
    icon_bytes: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ItemStrings {
    #[serde(untagged)]
    English {
        name: String,
        article_type: EnglishArticle,
        singular_name: String,
        plural_name: String,
        description: String,
    },

    #[serde(untagged)]
    Japanese { name: String, description: String },

    #[serde(untagged)]
    Name { name: String },
}

#[derive(Debug, Clone)]
pub enum ItemStringContent {
    Number(u32),
    StringBytes(Vec<u8>),
}

impl ItemStringContent {
    pub fn from_string(str: &String) -> Result<Self> {
        let mut string_walker = VecByteWalker::with_size(28);

        // Start of string and initial padding
        string_walker.write::<u32>(1);
        for _ in 0..6 {
            string_walker.write::<u32>(0);
        }

        string_walker.write_bytes(&Encoder::encode_simple(str)?);
        string_walker.write::<u8>(0); // End of string

        // Alignment padding
        let padding = get_padding(string_walker.offset());
        for _ in 0..padding {
            string_walker.write::<u8>(0);
        }
        Ok(ItemStringContent::StringBytes(string_walker.into_vec()))
    }

    pub fn from_article(article: impl Into<u32>) -> Self {
        ItemStringContent::Number(article.into())
    }
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ItemCategory {
    Unknown,
    Currency,
    Item,
    Armor,
    Weapon,
    PuppetItem,
    UsableItem,
    Slip,
    Instinct,
    Monipulator,
}

impl ItemCategory {
    pub fn from_id(id: u32) -> Self {
        match id {
            0xFFFF => ItemCategory::Currency,
            0..=0xFFF => ItemCategory::Item,
            0x1000..=0x1FFF => ItemCategory::UsableItem,
            0x2000..=0x21FF => ItemCategory::PuppetItem,
            0x2200..=0x27FF => ItemCategory::Item,
            0x2800..=0x3FFF => ItemCategory::Armor,
            0x4000..=0x59FF => ItemCategory::Weapon,
            0x5A00..=0x6FFF => ItemCategory::Armor,
            0x7000..=0x73FF => ItemCategory::Slip,
            0x7400..=0x77FF => ItemCategory::Instinct,
            0x7800..=0xF1FF => ItemCategory::Monipulator,
            0xF200.. => ItemCategory::Item,
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EquipmentData {
    level: u16,
    slots: EquipmentSlot,
    races: Race,
    jobs: JobFlag,
    superior_level: u16,
    shield_size: u16,

    max_charges: u8,
    casting_time: u8,
    use_delay: u16,
    reuse_delay: u32,
    unknown1: u16,
    ilevel: u8,
    unknown2: u8,
    unknown3: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeaponData {
    damage: u16,
    delay: u16,
    dps: u16,
    skill_type: SkillType,
    jug_size: u8,
    emote: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PuppetItemData {
    slot: PuppetSlot,
    element_charge: ElementValues,
    unknown1: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementValues {
    fire: u8,
    ice: u8,
    wind: u8,
    earth: u8,
    lightning: u8,
    water: u8,
    light: u8,
    dark: u8,
}

impl From<u32> for ElementValues {
    fn from(value: u32) -> Self {
        ElementValues {
            fire: get_nibble(value, 0),
            ice: get_nibble(value, 1),
            wind: get_nibble(value, 2),
            earth: get_nibble(value, 3),
            lightning: get_nibble(value, 4),
            water: get_nibble(value, 5),
            light: get_nibble(value, 6),
            dark: get_nibble(value, 7),
        }
    }
}

impl From<ElementValues> for u32 {
    fn from(value: ElementValues) -> Self {
        value.fire as u32
            + ((value.ice as u32) << (4 * 1))
            + ((value.wind as u32) << (4 * 2))
            + ((value.earth as u32) << (4 * 3))
            + ((value.lightning as u32) << (4 * 4))
            + ((value.water as u32) << (4 * 5))
            + ((value.light as u32) << (4 * 6))
            + ((value.dark as u32) << (4 * 7))
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstinctData {
    unknown1: u32,
    unknown2: u32,
    unknown3: u16,
    instinct_cost: u16,
    unknown4: u16,
    unknown5: u32,
    unknown6: u32,
    unknown7: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FurnishingData {
    element: Element,
    storage_slots: u32,
    unknown3: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsableItemData {
    activation_time: u16,
    unknown1: u32,
    unknown2: u32,
    // u32 in the legacy layout, u16 in the extended one.
    unknown3: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CurrencyData {
    unknown1: u16,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlipData {
    unknown1: u16,
    // u32 in the legacy layout, u16 in the extended one.
    unknown2: u32,
    unknowns: [u32; 16],
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonipulatorData {
    unknown1: u16,
    unknowns: [u32; 24],
}

// Number of monipulator u32s before the extended layout's u16 pad.
const MONIPULATOR_PAD_AFTER: usize = 8;

fn read_u16_or_u32<T: ByteWalker>(walker: &mut T, layout: ItemInfoLayout) -> Result<u32> {
    if layout.is_extended() {
        return Ok(walker.step::<u16>()? as u32);
    }
    walker.step::<u32>()
}

fn write_u16_or_u32<T: WritingByteWalker>(
    walker: &mut T,
    layout: ItemInfoLayout,
    value: u32,
    field: &str,
) -> Result<()> {
    if !layout.is_extended() {
        walker.write(value);
        return Ok(());
    }

    let narrowed = u16::try_from(value)
        .map_err(|_| anyhow!("{} must fit in 16 bits for the extended layout: {}", field, value))?;
    walker.write(narrowed);
    Ok(())
}

fn expect_layout_pad<T: ByteWalker>(walker: &mut T, layout: ItemInfoLayout, what: &str) -> Result<()> {
    if !layout.is_extended() {
        return Ok(());
    }
    walker.expect_msg::<u16>(0, what)
}

fn write_layout_pad<T: WritingByteWalker>(walker: &mut T, layout: ItemInfoLayout) {
    if layout.is_extended() {
        walker.write::<u16>(0);
    }
}

impl ItemInfo {
    pub fn parse<T: ByteWalker>(walker: &mut T, layout: ItemInfoLayout) -> Result<ItemInfo> {
        let entry_size = layout.entry_size();
        let mut item_bytes = walker.take_bytes(entry_size)?.to_vec();
        rotate_all(&mut item_bytes, 5);

        // Parse the icon
        let mut icon_walker = BufferedByteWalker::on(&item_bytes[DATA_SIZE..]);
        let icon_size = icon_walker.step::<u32>()?;
        let icon_bytes = icon_walker.take_bytes(icon_size as usize)?.to_vec();

        icon_walker.expect_n_msg::<u8>(0, icon_walker.remaining() - 1, "Padding after icon")?;
        icon_walker.expect_msg::<u8>(0xFF, "End of icon bytes")?;

        // Parse the data
        let mut data_walker: BufferedByteWalker<&[u8]> =
            BufferedByteWalker::on(&item_bytes[..DATA_SIZE]);

        let mut item_info = ItemInfo {
            icon_bytes,
            ..Default::default()
        };

        item_info.id = data_walker.step::<u32>()?;
        let item_category = ItemCategory::from_id(item_info.id);

        // TODO: Monipulators seems to have a totally different structure than other items,
        //       since the values it gets for the following are non-sensical.

        item_info.flags = ItemFlag::from_bits(data_walker.step::<u16>()?).unwrap_or_default();
        expect_layout_pad(&mut data_walker, layout, "Padding after flags")?;
        item_info.stack_size = data_walker.step::<u16>()?;
        item_info.item_type = ItemType::from(data_walker.step::<u16>()?);
        item_info.resource_id = data_walker.step::<u16>()?;
        item_info.valid_targets =
            ValidTargets::from_bits(data_walker.step::<u16>()?).unwrap_or_default();

        if item_category == ItemCategory::Armor || item_category == ItemCategory::Weapon {
            let level = data_walker.step::<u16>()?;
            let slots = EquipmentSlot::from_bits(data_walker.step::<u16>()?).unwrap_or_default();
            let races = Race::from_bits(data_walker.step::<u16>()?).unwrap_or_default();
            expect_layout_pad(&mut data_walker, layout, "Padding after races")?;
            let jobs = JobFlag::from_bits(data_walker.step::<u32>()?).unwrap_or_default();
            let superior_level = data_walker.step::<u16>()?;
            let shield_size = data_walker.step::<u16>()?;

            if item_category == ItemCategory::Weapon {
                item_info.weapon = Some(WeaponData {
                    damage: data_walker.step::<u16>()?,
                    delay: data_walker.step::<u16>()?,
                    dps: data_walker.step::<u16>()?,
                    skill_type: SkillType::try_from(data_walker.step::<u8>()?)?,
                    jug_size: data_walker.step::<u8>()?,
                    emote: data_walker.step::<u32>()?,
                });
            }

            let max_charges = data_walker.step::<u8>()?;
            let casting_time = data_walker.step::<u8>()?;
            let use_delay = data_walker.step::<u16>()?;
            let reuse_delay = data_walker.step::<u32>()?;
            let unknown1 = data_walker.step::<u16>()?;
            let ilevel = data_walker.step::<u8>()?;
            let unknown2 = data_walker.step::<u8>()?;
            let unknown3 = data_walker.step::<u32>()?;

            item_info.equipment = Some(EquipmentData {
                level,
                slots,
                races,
                jobs,
                superior_level,
                shield_size,
                max_charges,
                casting_time,
                use_delay,
                reuse_delay,
                unknown1,
                ilevel,
                unknown2,
                unknown3,
            });
        } else if item_category == ItemCategory::PuppetItem {
            let slot = PuppetSlot::try_from(data_walker.step::<u16>()?)?;
            expect_layout_pad(&mut data_walker, layout, "Padding after puppet slot")?;
            item_info.puppet = Some(PuppetItemData {
                slot,
                element_charge: ElementValues::from(data_walker.step::<u32>()?),
                unknown1: data_walker.step::<u32>()?,
            });
        } else if item_category == ItemCategory::Instinct {
            item_info.instinct = Some(InstinctData {
                unknown1: data_walker.step::<u32>()?,
                unknown2: data_walker.step::<u32>()?,
                unknown3: data_walker.step::<u16>()?,
                instinct_cost: data_walker.step::<u16>()?,
                unknown4: data_walker.step::<u16>()?,
                unknown5: data_walker.step::<u32>()?,
                unknown6: data_walker.step::<u32>()?,
                unknown7: data_walker.step::<u32>()?,
            });
        } else if item_category == ItemCategory::Item {
            item_info.furnishing = Some(FurnishingData {
                element: Element::try_from(data_walker.step::<u16>()?)?,
                storage_slots: data_walker.step::<u32>()?,
                unknown3: data_walker.step::<u32>()?,
            });
            expect_layout_pad(&mut data_walker, layout, "Padding after furnishing data")?;
        } else if item_category == ItemCategory::UsableItem {
            item_info.usable_item = Some(UsableItemData {
                activation_time: data_walker.step::<u16>()?,
                unknown1: data_walker.step::<u32>()?,
                unknown2: data_walker.step::<u32>()?,
                unknown3: read_u16_or_u32(&mut data_walker, layout)?,
            });
        } else if item_category == ItemCategory::Currency {
            item_info.currency = Some(CurrencyData {
                unknown1: data_walker.step::<u16>()?,
            });
        } else if item_category == ItemCategory::Slip {
            item_info.slip = Some(SlipData {
                unknown1: data_walker.step::<u16>()?,
                unknown2: read_u16_or_u32(&mut data_walker, layout)?,
                unknowns: core::array::from_fn(|_| data_walker.step::<u32>().unwrap_or_default()),
            });
        } else if item_category == ItemCategory::Monipulator {
            let unknown1 = data_walker.step::<u16>()?;
            let mut unknowns = [0u32; 24];
            for (index, unknown) in unknowns.iter_mut().enumerate() {
                if index == MONIPULATOR_PAD_AFTER {
                    expect_layout_pad(&mut data_walker, layout, "Padding in monipulator data")?;
                }
                *unknown = data_walker.step::<u32>()?;
            }
            item_info.monipulator = Some(MonipulatorData { unknown1, unknowns });
        }

        // Parse string data
        let content_count = data_walker.step::<u32>()?;
        if content_count > 9 {
            return Err(anyhow!(
                "Unsupported strings content of length: {}",
                content_count
            ));
        }

        let mut metas = Vec::with_capacity(content_count as usize);
        for _ in 0..content_count {
            metas.push((data_walker.step::<u32>()?, data_walker.step::<u32>()?));
        }

        match content_count {
            1 => {
                // Just one string name
                item_info.strings = Some(ItemStrings::Name {
                    name: Self::read_string(&mut data_walker)?,
                });
            }
            2 => {
                // Japanese
                item_info.strings = Some(ItemStrings::Japanese {
                    name: Self::read_string(&mut data_walker)?,
                    description: Self::read_string(&mut data_walker)?,
                });
            }
            5 => {
                // English
                item_info.strings = Some(ItemStrings::English {
                    name: Self::read_string(&mut data_walker)?,
                    article_type: EnglishArticle::try_from(data_walker.step::<u32>()?)?,
                    singular_name: Self::read_string(&mut data_walker)?,
                    plural_name: Self::read_string(&mut data_walker)?,
                    description: Self::read_string(&mut data_walker)?,
                });
            }
            count => {
                return Err(anyhow!("Unsupported string count: {}", count));
            }
        }

        data_walker.expect_n_msg::<u32>(
            0,
            data_walker.remaining() / 4,
            "Zero padding at end of data",
        )?;

        Ok(item_info)
    }

    fn read_string<T: ByteWalker>(walker: &mut T) -> Result<String> {
        walker.expect_msg::<u32>(1, "Expected 1 at start of string.")?;
        walker.expect_n_msg::<u32>(0, 6, "Expected 0 padding before string.")?;

        let text_bytes = walker.step_until(0)?;
        let string = Decoder::decode_simple(text_bytes);

        let alignment_padding = get_padding(text_bytes.len() + 1);
        walker.expect_msg::<u8>(0, "End of string")?;
        walker.expect_n_msg::<u8>(0, alignment_padding, "Expected 0 padding after string.")?;

        string
    }

    pub fn write<T: WritingByteWalker>(
        &self,
        outer_walker: &mut T,
        layout: ItemInfoLayout,
    ) -> Result<()> {
        let entry_size = layout.entry_size();
        let mut walker = VecByteWalker::with_size(entry_size);

        walker.write(self.id);
        walker.write(self.flags.bits());
        write_layout_pad(&mut walker, layout);

        // Write item data
        walker.write(self.stack_size);
        walker.write::<u16>(self.item_type.into());
        walker.write(self.resource_id);
        walker.write(self.valid_targets.bits());

        if let Some(equipment) = &self.equipment {
            walker.write(equipment.level);
            walker.write(equipment.slots.bits());
            walker.write(equipment.races.bits());
            write_layout_pad(&mut walker, layout);
            walker.write(equipment.jobs.bits());
            walker.write(equipment.superior_level);
            walker.write(equipment.shield_size);

            if let Some(weapon) = &self.weapon {
                walker.write(weapon.damage);
                walker.write(weapon.delay);
                walker.write(weapon.dps);
                walker.write::<u8>(weapon.skill_type.into());
                walker.write(weapon.jug_size);
                walker.write(weapon.emote);
            }

            walker.write(equipment.max_charges);
            walker.write(equipment.casting_time);
            walker.write(equipment.use_delay);
            walker.write(equipment.reuse_delay);
            walker.write(equipment.unknown1);
            walker.write(equipment.ilevel);
            walker.write(equipment.unknown2);
            walker.write(equipment.unknown3);
        } else if let Some(puppet) = &self.puppet {
            walker.write::<u16>(puppet.slot.into());
            write_layout_pad(&mut walker, layout);
            walker.write::<u32>(puppet.element_charge.into());
            walker.write(puppet.unknown1);
        } else if let Some(instinct) = &self.instinct {
            walker.write(instinct.unknown1);
            walker.write(instinct.unknown2);
            walker.write(instinct.unknown3);
            walker.write(instinct.instinct_cost);
            walker.write(instinct.unknown4);
            walker.write(instinct.unknown5);
            walker.write(instinct.unknown6);
            walker.write(instinct.unknown7);
        } else if let Some(furnishing) = &self.furnishing {
            walker.write::<u16>(furnishing.element.into());
            walker.write(furnishing.storage_slots);
            walker.write(furnishing.unknown3);
            write_layout_pad(&mut walker, layout);
        } else if let Some(usable_item) = &self.usable_item {
            walker.write(usable_item.activation_time);
            walker.write(usable_item.unknown1);
            walker.write(usable_item.unknown2);
            write_u16_or_u32(&mut walker, layout, usable_item.unknown3, "usable_item.unknown3")?;
        } else if let Some(currency) = &self.currency {
            walker.write(currency.unknown1);
        } else if let Some(slip) = &self.slip {
            walker.write(slip.unknown1);
            write_u16_or_u32(&mut walker, layout, slip.unknown2, "slip.unknown2")?;
            for unknown in slip.unknowns {
                walker.write(unknown);
            }
        } else if let Some(monipulator) = &self.monipulator {
            walker.write(monipulator.unknown1);
            for (index, unknown) in monipulator.unknowns.iter().enumerate() {
                if index == MONIPULATOR_PAD_AFTER {
                    write_layout_pad(&mut walker, layout);
                }
                walker.write(*unknown);
            }
        }

        // Write strings
        let mut string_content = vec![];

        match &self.strings {
            Some(ItemStrings::Name { name }) => {
                string_content.push(ItemStringContent::from_string(name)?);
            }
            Some(ItemStrings::Japanese { name, description }) => {
                string_content.push(ItemStringContent::from_string(name)?);
                string_content.push(ItemStringContent::from_string(description)?);
            }
            Some(ItemStrings::English {
                name,
                article_type,
                singular_name,
                plural_name,
                description,
            }) => {
                string_content.push(ItemStringContent::from_string(name)?);
                string_content.push(ItemStringContent::from_article(*article_type));
                string_content.push(ItemStringContent::from_string(singular_name)?);
                string_content.push(ItemStringContent::from_string(plural_name)?);
                string_content.push(ItemStringContent::from_string(description)?);
            }
            None => {}
        }

        // Write metas
        walker.write::<u32>(string_content.len() as u32);

        let mut current_offset: u32 = string_content.len() as u32 * 8 + 4;
        for content in &string_content {
            match content {
                ItemStringContent::Number(_) => {
                    walker.write::<u32>(current_offset);
                    walker.write::<u32>(1);

                    current_offset += 4;
                }
                ItemStringContent::StringBytes(string_bytes) => {
                    walker.write::<u32>(current_offset);
                    walker.write::<u32>(0);

                    current_offset += string_bytes.len() as u32;
                }
            }
        }

        // Write string content
        for content in &string_content {
            match content {
                ItemStringContent::Number(number) => {
                    walker.write(*number);
                }
                ItemStringContent::StringBytes(string_bytes) => {
                    walker.write_bytes(string_bytes);
                }
            }
        }

        if walker.offset() > DATA_SIZE {
            return Err(anyhow!(
                "Item {} data overflows the {} byte data block by {} bytes.",
                self.id,
                DATA_SIZE,
                walker.offset() - DATA_SIZE
            ));
        }

        // Write icon bytes
        walker.goto(DATA_SIZE as u32);
        walker.write(self.icon_bytes.len() as u32);
        walker.write_bytes(&self.icon_bytes);
        walker.write_at::<u8>(entry_size - 1, 0xFF);

        rotate_all(walker.as_mut_slice(), 3);
        outer_walker.write_bytes(walker.as_slice());

        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ItemInfoTable {
    #[serde(default)]
    pub layout: ItemInfoLayout,
    items: Vec<ItemInfo>,
}

impl ItemInfoTable {
    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Tries each layout whose entry size divides the DAT, accepting the first whose leading
    /// entry parses. Extended is tried first since some sizes divide both entry sizes.
    pub fn detect_layout<T: ByteWalker>(walker: &mut T) -> Result<ItemInfoLayout> {
        let len = walker.len();
        for layout in ItemInfoLayout::CANDIDATES {
            if len == 0 || len % layout.entry_size() != 0 {
                continue;
            }
            walker.goto_start();
            if ItemInfo::parse(walker, layout).is_ok() {
                walker.goto_start();
                return Ok(layout);
            }
        }

        Err(anyhow!(
            "Length does not match an item info DAT of any known layout: {}",
            len
        ))
    }

    pub fn parse<T: ByteWalker>(walker: &mut T) -> Result<Self> {
        let layout = Self::detect_layout(walker)?;

        let entry_count = walker.len() / layout.entry_size();
        let mut items = Vec::with_capacity(entry_count);
        for _ in 0..entry_count {
            items.push(ItemInfo::parse(walker, layout)?);
        }

        Ok(ItemInfoTable { layout, items })
    }

    pub fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        walker.set_size(self.items.len() * self.layout.entry_size());

        for item in &self.items {
            item.write(walker, self.layout)?;
        }

        Ok(())
    }
}

impl DatFormat for ItemInfoTable {
    fn from<T: ByteWalker>(walker: &mut T) -> Result<Self> {
        ItemInfoTable::parse(walker)
    }

    fn check_type<T: ByteWalker>(walker: &mut T) -> Result<()> {
        ItemInfoTable::detect_layout(walker)?;
        Ok(())
    }

    fn write<T: WritingByteWalker>(&self, walker: &mut T) -> Result<()> {
        self.write(walker)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::{dat_format::DatFormat, enums::EnglishArticle};

    use super::{ItemInfoLayout, ItemInfoTable, ItemStrings};

    fn test_path(file_name: &str) -> PathBuf {
        let mut dat_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dat_path.push("resources/test");
        dat_path.push(file_name);
        dat_path
    }

    fn expect_english(strings: &ItemStrings) -> (&str, &EnglishArticle, &str, &str, &str) {
        if let ItemStrings::English {
            name,
            article_type,
            singular_name,
            plural_name,
            description,
        } = strings
        {
            return (name, article_type, singular_name, plural_name, description);
        }
        panic!("Expected english strings")
    }

    #[test]
    pub fn weapons() {
        let dat_path = test_path("weapons.DAT");

        ItemInfoTable::check_path(&dat_path).unwrap();
        let res = ItemInfoTable::from_path_checked_yaml(&dat_path).unwrap();
        assert_eq!(res.layout, ItemInfoLayout::Legacy);

        let (name, article_type, singular_name, plural_name, description) =
            expect_english(res.items[4329].strings.as_ref().unwrap());
        assert_eq!(name, "Excalipoor");
        assert_eq!(article_type, &EnglishArticle::An);
        assert_eq!(singular_name, "Excalipoor");
        assert_eq!(plural_name, "Excalipoors");
        assert_eq!(description, "DMG:1 Delay:240");
    }

    #[test]
    pub fn weapons_extended() {
        let dat_path = test_path("weapons_extended.DAT");

        ItemInfoTable::check_path(&dat_path).unwrap();
        let res = ItemInfoTable::from_path_checked_yaml(&dat_path).unwrap();
        assert_eq!(res.layout, ItemInfoLayout::Extended);
        assert_eq!(res.items.len(), 6656);

        let (name, article_type, singular_name, plural_name, description) =
            expect_english(res.items[4329].strings.as_ref().unwrap());
        assert_eq!(name, "Excalipoor");
        assert_eq!(article_type, &EnglishArticle::An);
        assert_eq!(singular_name, "Excalipoor");
        assert_eq!(plural_name, "Excalipoors");
        assert_eq!(description, "DMG:1 Delay:240");
    }

    #[test]
    pub fn usable_items_extended() {
        let dat_path = test_path("usable_items_extended.DAT");

        ItemInfoTable::check_path(&dat_path).unwrap();
        let res = ItemInfoTable::from_path_checked_yaml(&dat_path).unwrap();
        assert_eq!(res.layout, ItemInfoLayout::Extended);
        assert_eq!(res.items.len(), 4096);
        assert!(res.items[0].usable_item.is_some());
    }

    #[test]
    pub fn puppet_items_extended() {
        let dat_path = test_path("puppet_items_extended.DAT");

        ItemInfoTable::check_path(&dat_path).unwrap();
        let res = ItemInfoTable::from_path_checked_yaml(&dat_path).unwrap();
        assert_eq!(res.layout, ItemInfoLayout::Extended);
        assert_eq!(res.items.len(), 512);
        assert!(res.items[0].puppet.is_some());
    }

    #[test]
    pub fn general_items2_extended() {
        let dat_path = test_path("general_items2_extended.DAT");

        ItemInfoTable::check_path(&dat_path).unwrap();
        let res = ItemInfoTable::from_path_checked_yaml(&dat_path).unwrap();
        assert_eq!(res.layout, ItemInfoLayout::Extended);
        assert_eq!(res.items.len(), 1536);
        assert!(res.items[0].furnishing.is_some());
    }

    #[test]
    pub fn armor2() {
        let dat_path = test_path("armor2.DAT");

        ItemInfoTable::check_path(&dat_path).unwrap();
        let res = ItemInfoTable::from_path_checked_yaml(&dat_path).unwrap();
        assert_eq!(res.layout, ItemInfoLayout::Legacy);

        let (name, article_type, singular_name, plural_name, description) =
            expect_english(res.items[3827].strings.as_ref().unwrap());
        assert_eq!(name, "Voodoo Mail");
        assert_eq!(article_type, &EnglishArticle::SuitsOf);
        assert_eq!(singular_name, "voodoo mail");
        assert_eq!(plural_name, "suits of voodoo mail");
        assert_eq!(
            description,
            "The envious aura that looms over\nthis mail seems to invite utter\nruin to descend upon its bearer."
        );
    }

    #[test]
    pub fn armor_jp() {
        let dat_path = test_path("armor_jp.DAT");

        ItemInfoTable::check_path(&dat_path).unwrap();
        let res = ItemInfoTable::from_path_checked_yaml(&dat_path).unwrap();
        assert_eq!(res.layout, ItemInfoLayout::Legacy);

        if let ItemStrings::Japanese { name, description } =
            res.items[2221].strings.as_ref().unwrap()
        {
            assert_eq!(name, "スコピオヘルム+1");
            assert_eq!(
                description,
                "防23 耐火+8 レジストパライズ効果アップ\n麻痺:リフレシュ"
            );
        } else {
            panic!("Expected japanese strings")
        }
    }
}
