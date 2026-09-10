mod analyze_meshes;
mod convert_item_layout;
mod entity_names_merge;
mod export_dat;
mod export_ximesh;
mod make_dats;
mod scan_dats;
mod util;

use std::path::PathBuf;

use analyze_meshes::analyze_zone_meshes;
use convert_item_layout::{ItemLayoutArg, convert_item_layout};
use anyhow::Result;
use clap::{Parser, Subcommand};

use dats::base::DatId;
use entity_names_merge::migrate_entity_names;
use export_ximesh::export_zone_meshes;
use make_dats::make_dats;

use crate::{export_dat::export_dat, scan_dats::scan_dats};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    ExportZoneMesh {
        #[arg(value_name = "FFXI_PATH")]
        ffxi_path: String,

        #[arg(value_name = "OUT_DIR")]
        out_dir: Option<String>,
    },

    AnalyzeZoneMesh {
        #[arg(value_name = "FFXI_PATH")]
        ffxi_path: String,
    },

    MakeDats {
        #[arg(value_name = "PROJECT_DIR")]
        project_dir: PathBuf,

        #[arg(value_name = "YAML_FILES")]
        yaml_files: Vec<PathBuf>,

        #[arg(short, long)]
        out: Option<PathBuf>,
    },

    ScanDats {
        #[arg(value_name = "FFXI_PATH")]
        ffxi_path: PathBuf,
    },

    ExportDat {
        #[arg(value_name = "FFXI_PATH")]
        ffxi_path: PathBuf,

        #[arg(long)]
        dat_path: Option<PathBuf>,

        #[arg(long)]
        dat_id: Option<u32>,

        #[arg(value_name = "OUT_PATH")]
        out_path: Option<PathBuf>,
    },

    ConvertItemLayout {
        #[arg(value_name = "INPUT_DAT_OR_DIR")]
        input: PathBuf,

        #[arg(short, long, value_name = "OUTPUT_DAT_OR_DIR")]
        out: Option<PathBuf>,

        #[arg(long, value_enum, default_value_t = ItemLayoutArg::Extended)]
        layout: ItemLayoutArg,
    },

    MigrateEntityNames {
        #[arg(value_name = "EDITED_YAML_OR_DAT")]
        edited_yaml: PathBuf,

        #[arg(value_name = "RETAIL_YAML_OR_DAT")]
        retail_yaml: PathBuf,

        #[arg(value_name = "NEW_YAML")]
        new_yaml: PathBuf,

        #[arg(long, value_name = "BASELINE_RETAIL_YAML_OR_DAT")]
        baseline_retail: Option<PathBuf>,

        #[arg(long, value_name = "OUT_DAT")]
        out_dat: Option<PathBuf>,

        #[arg(long, value_name = "REPORT_YAML")]
        report: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    match args.command {
        Commands::ExportZoneMesh { ffxi_path, out_dir } => {
            export_zone_meshes(
                PathBuf::from(ffxi_path),
                PathBuf::from(out_dir.unwrap_or(".".to_string())),
            )
            .await?;
        }
        Commands::AnalyzeZoneMesh { ffxi_path } => {
            analyze_zone_meshes(PathBuf::from(ffxi_path)).await?;
        }
        Commands::MakeDats {
            project_dir,
            yaml_files,
            out,
        } => {
            make_dats(project_dir, &yaml_files, out)?;
        }
        Commands::ScanDats { ffxi_path } => {
            scan_dats(ffxi_path)?;
        }
        Commands::ExportDat {
            ffxi_path,
            dat_path,
            dat_id,
            out_path,
        } => {
            export_dat(ffxi_path, dat_path, dat_id.map(DatId::from), out_path)?;
        }
        Commands::ConvertItemLayout { input, out, layout } => {
            convert_item_layout(input, out, layout)?;
        }
        Commands::MigrateEntityNames {
            edited_yaml,
            retail_yaml,
            new_yaml,
            baseline_retail,
            out_dat,
            report,
        } => {
            migrate_entity_names(
                edited_yaml,
                retail_yaml,
                baseline_retail,
                Some(new_yaml),
                report,
                out_dat,
            )?;
        }
    }

    Ok(())
}
