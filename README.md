# Kraken

Kraken is a tool for directly editing **FFXI DAT files**.

It is built on top of the work originally done in **XI Tinkerer**, but the goal of Kraken is not just to export and re-encode DATs. Instead, Kraken is focused on making DAT editing more practical through a dedicated interface, editing tools, workflow improvements, and expanded tooling around DAT manipulation.

Under the hood, Kraken still relies on structured parsing and data conversion to safely read and write DAT content, but the intended experience is direct editing rather than a manual export/import workflow.

## Origin

Kraken began as a fork of **XI Tinkerer**.

This project is based on the original XI Tinkerer codebase and remains open source under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. Original credits and third-party attributions are preserved below.

Kraken includes additional modifications and features beyond the original project, including editing tools, sidebar improvements, UI changes, and ongoing workflow enhancements.

> Modified from the original XI Tinkerer project. Rebranded and extended as Kraken. Initial Kraken fork/modifications: [4/20/26]

## Goals

Kraken is intended to make DAT editing more accessible and more efficient by reducing the amount of manual conversion work needed from the user.

Current and planned goals include:

- Direct editing workflows for supported DAT structures
- Improved UI and navigation for working with DAT content
- Expanded editing tools and utilities
- More practical workflows for modifying DAT files
- Continued support for structured parsing and regeneration of DAT data
- Long-term expansion into more DAT formats, languages, and editing features

## Development setup

The project is built using [Rust](https://www.rust-lang.org/) utilizing the [tauri](https://tauri.app/) toolkit for building the application. The frontend UI is built using the [solidjs](https://www.solidjs.com/) framework.

### Prerequisites

The following software is required to develop and build the application:

- [Rust](https://www.rust-lang.org/learn/get-started) (and cargo) for the backend
- [Prerequisites for building tauri applications](https://tauri.app/v1/guides/getting-started/prerequisites)
- [NodeJS](https://nodejs.org/en/download) for the frontend
- [pnpm](https://pnpm.io/installation) as the NodeJS package manager

### Developing

The backend rust crates can be built/tested/etc with the regular `cargo build`, `cargo test`, etc.

To develop on the frontend, navigate to the `client` directory and install the necessary dependencies with `pnpm install`.

Once they're installed, you can develop the frontend application using the following command, which will provide automatic (hot-)reloading whenever the frontend or tauri-backend crate changes:

```sh
pnpm tauri dev
```

## Credits

Kraken is based on **XI Tinkerer**. Credit goes to the original author(s) and contributors of that project for the foundation this fork builds on.

The starting point for the binary structure of some of the DAT formats, which are used in this project,
were partially derived from the [POLUtils project](https://github.com/Windower/POLUtils) code,
so credit goes to them for their work in reversing these. Their work is licensed under the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0) with the following copyright:

    Copyright © 2004-2014 Tim Van Holder, Nevin Stepan, Windower Team

This project also uses encoding conversion table files, which were originally from the POLUtils project,
but some have been modified to allow them being used in reverse to allow encoding back to the original symbols.
The full license file and copyright text have been included in the folder that these reside in.


### Events

Decoding of events and the byte code is done based on [XiEvents](https://github.com/atom0s/XiEvents) by atom0s. The license associated with the repository [can be found here](https://github.com/atom0s/XiEvents/blob/main/LICENSE.md), which is currently AGPL.

### Attribution Notes

Kraken is a modified fork and is not the original XI Tinkerer project.

Please preserve original license notices, copyright notices, and third-party attributions when redistributing or modifying this project.
