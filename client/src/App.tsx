import Sidebar, { NavItem } from "./components/Sidebar";
import Statusbar from "./components/Statusbar";
import Home from "./components/Home";
import { Routes, Route } from "@solidjs/router";
import {
  HiSolidAdjustmentsHorizontal,
  HiSolidArrowsRightLeft,
  HiSolidChatBubbleLeftRight,
  HiSolidCog8Tooth,
  HiSolidDocumentText,
  HiSolidMagnifyingGlass,
  HiSolidMap,
  HiSolidPencilSquare,
  HiSolidPlayCircle,
  HiSolidShoppingBag,
  HiSolidUser,
} from "solid-icons/hi";
import DatTable from "./components/DatTable";
import ZonesTable from "./components/ZonesTable";
import Table from "./components/Table";
import ZoneData from "./components/ZoneData";
import { commands } from "./bindings";
import Logs from "./components/Logs";
import { unwrap } from "./util";
import EntityDiffTool from "./components/EntityDiffTool";
import FileDiffsTool from "./components/FileDiffsTool";
import ItemDiffTool from "./components/ItemDiffTool";
import ItemEditorTool from "./components/ItemEditorTool";
import SpellDiffTool from "./components/SpellDiffTool";
import AbilityDiffTool from "./components/AbilityDiffTool";
import ZoneEditorTool from "./components/ZoneEditorTool";

function formatDatDescriptorType(type: string) {
  if (type === "DataMenu") {
    return "Spell/Ability New Data";
  }
  if (type === "OldDataMenu") {
    return "Spell/Ability Old Data";
  }
  return type;
}

const navItems: NavItem[] = [
  {
    name: "Home",
    path: "/",
    icon: () => <HiSolidCog8Tooth />,
  },
  {
    group: "Edit Tools",
    defaultExpanded: true,
    sections: [
      {
        header: "Compare Tools",
        items: [
          {
            name: "File Diffs",
            path: "/file-diffs",
            icon: () => <HiSolidMagnifyingGlass />,
          },
          {
            name: "Entities",
            path: "/entity-diff",
            icon: () => <HiSolidArrowsRightLeft />,
          },
          {
            name: "Items",
            path: "/item-diff",
            icon: () => <HiSolidArrowsRightLeft />,
          },
        ],
      },
      {
        header: "Direct Edit Tools",
        items: [
          {
            name: "Items",
            path: "/item-editor",
            icon: () => <HiSolidPencilSquare />,
          },
          {
            name: "Spells",
            path: "/spell-diff",
            icon: () => <HiSolidArrowsRightLeft />,
          },
          {
            name: "Abilities",
            path: "/ability-diff",
            icon: () => <HiSolidArrowsRightLeft />,
          },
          {
            name: "Zones",
            path: "/zone-editor",
            icon: () => <HiSolidMap />,
          },
        ],
      },
    ],
  },
  {
    group: "Encode/Decode",
    defaultExpanded: true,
    sections: [
      {
        header: "Strings",
        items: [
          {
            name: "String tables",
            path: "/strings",
            icon: () => <HiSolidPencilSquare />,
          },
          {
            name: "Global dialog",
            path: "/global_dialog",
            icon: () => <HiSolidChatBubbleLeftRight />,
          },
          {
            name: "Missions",
            path: "/missions",
            icon: () => <HiSolidDocumentText />,
          },
          {
            name: "Quests",
            path: "/quests",
            icon: () => <HiSolidDocumentText />,
          },
        ],
      },
      {
        header: "By zone",
        items: [
          {
            name: "Entity names",
            path: "/entities",
            icon: () => <HiSolidUser />,
          },
          {
            name: "Dialog",
            path: "/dialog",
            icon: () => <HiSolidChatBubbleLeftRight />,
          },
          {
            name: "Dialog (2)",
            path: "/dialog2",
            icon: () => <HiSolidChatBubbleLeftRight />,
          },
          {
            name: "Events",
            path: "/events",
            icon: () => <HiSolidPlayCircle />,
          },
          {
            name: "Zone Data",
            path: "/zones",
            icon: () => <HiSolidMap />,
          },
        ],
      },
      {
        header: "Other",
        items: [
          {
            name: "Items",
            path: "/items",
            icon: () => <HiSolidShoppingBag />,
          },
          {
            name: "Misc.",
            path: "/misc",
            icon: () => <HiSolidAdjustmentsHorizontal />,
          },
        ],
      },
    ],
  },
];

function App() {
  return (
    <main class="app-shell">
      <div class="app-frame">
        <Sidebar navItems={navItems} />

        <div class="main-shell">
          <div class="content">
            <div class="content-shell">
              <Routes>
                <Route path="/" component={Home}></Route>

                <Route
                  path="/browse"
                  component={() => (
                    <Table
                      title="Browse"
                      rowsResourceFetcher={async () => unwrap(await commands.browseDats())}
                      columns={[{ name: "Name", key: "path" }, { name: "ID", key: "id" }]}
                      defaultSortColumn="path"
                    />
                  )}
                ></Route>

                <Route
                  path="/strings"
                  component={() => (
                    <DatTable
                      title="Strings"
                      rowsResourceFetcher={async () => unwrap(await commands.getStandaloneStringDats())}
                      columns={[{ name: "Name", getter: (v) => v.descriptor.type }]}
                      toDatDescriptor={(v) => v.descriptor}
                      hasJp={(v) => v.has_jp}
                    />
                  )}
                ></Route>

                <Route
                  path="/items"
                  component={() => (
                    <DatTable
                      title="Items"
                      rowsResourceFetcher={async () => unwrap(await commands.getItemDats())}
                      columns={[{ name: "Name", getter: (v) => v.descriptor.type }]}
                      toDatDescriptor={(v) => v.descriptor}
                      hasJp={(v) => v.has_jp}
                    />
                  )}
                ></Route>

                <Route
                  path="/misc"
                  component={() => (
                    <DatTable
                      title="Misc."
                      rowsResourceFetcher={async () => unwrap(await commands.getMiscDats())}
                      columns={[{ name: "Name", getter: (v) => formatDatDescriptorType(v.descriptor.type) }]}
                      toDatDescriptor={(v) => v.descriptor}
                    />
                  )}
                ></Route>

                <Route
                  path="/global_dialog"
                  component={() => (
                    <DatTable
                      title="Global Dialog"
                      rowsResourceFetcher={async () => unwrap(await commands.getGlobalDialogDats())}
                      columns={[{ name: "Name", getter: (v) => v.descriptor.type }]}
                      toDatDescriptor={(v) => v.descriptor}
                      hasJp={(v) => v.has_jp}
                    />
                  )}
                ></Route>

                <Route
                  path="/missions"
                  component={() => (
                    <DatTable
                      title="Missions"
                      rowsResourceFetcher={async () => unwrap(await commands.getMissionDats())}
                      columns={[{ name: "Name", getter: (v) => v.descriptor.type }]}
                      toDatDescriptor={(v) => v.descriptor}
                      hasJp={(v) => v.has_jp}
                    />
                  )}
                ></Route>

                <Route
                  path="/quests"
                  component={() => (
                    <DatTable
                      title="Quests"
                      rowsResourceFetcher={async () => unwrap(await commands.getQuestDats())}
                      columns={[{ name: "Name", getter: (v) => v.descriptor.type }]}
                      toDatDescriptor={(v) => v.descriptor}
                      hasJp={(v) => v.has_jp}
                    />
                  )}
                ></Route>

                <Route path="/zones">
                  <Route
                    path="/"
                    component={() => (
                      <ZonesTable />
                    )}>
                  </Route>

                  <Route path="/:id" component={ZoneData}></Route>
                </Route>

                <Route
                  path="/entities"
                  component={() => (
                    <DatTable
                      title="Entity Names"
                      rowsResourceFetcher={async () => unwrap(await commands.getZonesForType({ type: "EntityNames", index: 0 }))}
                      columns={[{ name: "Name", getter: (v) => v.name }, { name: "ID", getter: (v) => v.id }]}
                      toDatDescriptor={(zone) => ({ type: "EntityNames", index: zone.id })}
                    />
                  )}
                ></Route>

                <Route
                  path="/dialog"
                  component={() => (
                    <DatTable
                      title="Dialog"
                      rowsResourceFetcher={async () => unwrap(await commands.getZonesForType({ type: "Dialog", index: 0 }))}
                      columns={[{ name: "Name", getter: (v) => v.name }, { name: "ID", getter: (v) => v.id }]}
                      toDatDescriptor={(zone) => ({ type: "Dialog", index: zone.id })}
                    />
                  )}
                ></Route>

                <Route
                  path="/dialog2"
                  component={() => (
                    <DatTable
                      title="Dialog (2)"
                      rowsResourceFetcher={async () => unwrap(await commands.getZonesForType({ type: "Dialog2", index: 0 }))}
                      columns={[{ name: "Name", getter: (v) => v.name }, { name: "ID", getter: (v) => v.id }]}
                      toDatDescriptor={(zone) => ({ type: "Dialog2", index: zone.id })}
                    />
                  )}
                ></Route>

                <Route
                  path="/events"
                  component={() => (
                    <DatTable
                      title="Events"
                      rowsResourceFetcher={async () => unwrap(await commands.getZonesForType({ type: "Events", index: 0 }))}
                      columns={[{ name: "Name", getter: (v) => v.name }, { name: "ID", getter: (v) => v.id }]}
                      toDatDescriptor={(zone) => ({ type: "Events", index: zone.id })}
                    />
                  )}
                ></Route>

                <Route
                  path="/logs"
                  component={Logs}
                ></Route>

                <Route
                  path="/entity-diff"
                  component={EntityDiffTool}
                ></Route>

                <Route
                  path="/file-diffs"
                  component={FileDiffsTool}
                ></Route>

                <Route
                  path="/item-diff"
                  component={ItemDiffTool}
                ></Route>

                <Route
                  path="/item-editor"
                  component={ItemEditorTool}
                ></Route>

                <Route
                  path="/spell-diff"
                  component={SpellDiffTool}
                ></Route>

                <Route
                  path="/ability-diff"
                  component={AbilityDiffTool}
                ></Route>

                <Route
                  path="/zone-editor"
                  component={ZoneEditorTool}
                ></Route>
              </Routes>
            </div>
          </div>
          <Statusbar />
        </div>
      </div>
    </main>
  );
}

export default App;
