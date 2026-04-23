import {
  For,
  Match,
  Show,
  Switch,
  batch,
  createMemo,
  createResource,
  createSignal,
  onMount,
} from "solid-js";
import { commands, DatDescriptor } from "../bindings";
import { useData } from "../store";
import { unwrap } from "../util";

interface DatTableProps<T> {
  title: string;
  rowsResourceFetcher: () => Promise<T[]>,
  columns: { name: string, getter: (t: T) => any }[],
  defaultSortColumn?: number,
  toDatDescriptor: (t: T) => DatDescriptor,
  hasJp?: (t: T) => boolean,
}

function DatTable<T>
  ({ title, rowsResourceFetcher, columns, defaultSortColumn, toDatDescriptor, hasJp: hasJpGiven }: DatTableProps<T>) {
  const {
    processing: { canProcess, isProcessing, processing },
    workingFiles: { hasWorkingFile }
  } = useData();

  const hasJp = hasJpGiven ?? (() => false);

  const [rowsResource] = createResource(rowsResourceFetcher, { initialValue: [] });

  const [sortBy, setSortBy] = createSignal<number>(defaultSortColumn ?? 0);
  const [sortAsc, setSortAsc] = createSignal<boolean>(true);
  const [filterBy, setFilterBy] = createSignal<string>("");

  const updateSort = (columnIdx: number) => {
    if (columnIdx == sortBy()) {
      setSortAsc(!sortAsc());
    } else {
      batch(() => {
        setSortBy(columnIdx);
        setSortAsc(true);
      })
    }
  };

  const filteredRows = createMemo(() => {
    if (filterBy()) {
      const filterVal = filterBy();
      return rowsResource()
        .filter((e) => {
          return columns.find(c => {
            return ("" + c.getter(e)).toLowerCase().includes(filterVal.toLowerCase());
          })
        });
    } else {
      return [...(rowsResource())];
    }
  })

  const rows = createMemo(() => {
    const sortByGetter = columns[sortBy()].getter;
    const sortAscVal = sortAsc();
    const dir = sortAscVal ? 1 : -1;
    return filteredRows().sort((a, b) => {
      const aValue = sortByGetter(a);
      const bValue = sortByGetter(b);
      if (aValue < bValue) {
        return -1 * dir;
      } else if (aValue > bValue) {
        return 1 * dir;
      }
      return 0;
    }).slice(0, 1000);
  });


  // Make YAML
  const makeAllYaml = () => {
    if (!canProcess()) {
      return;
    }

    rows().forEach((row) => {
      commands.makeYaml(toDatDescriptor(row), "English");
      commands.makeYaml(toDatDescriptor(row), "Japanese");
    });
  };

  const makingYamlCount = createMemo(() => {
    return rows()
      .filter((row) => {
        const descriptor = toDatDescriptor(row);
        const key = "index" in descriptor ? descriptor.index : 0;
        return processing.Yaml?.[descriptor.type]?.[key] == true;
      })
      .length;
  });

  // Making DAT files from YAML
  const makeAllDats = () => {
    if (!canProcess()) {
      return;
    }

    rows().forEach((row) => {
      commands.makeDat(toDatDescriptor(row), "English");
    });
  };

  const makingDatCount = createMemo(() => {
    return rows()
      .filter((row) => {
        const descriptor = toDatDescriptor(row);
        const key = "index" in descriptor ? descriptor.index : 0;
        return processing.Dat?.[descriptor.type]?.[key] == true;
      })
      .length;
  });

  const visibleCount = createMemo(() => rows().length);
  const filteredCount = createMemo(() => filteredRows().length);

  let inputRef: HTMLInputElement;
  onMount(() => {
    inputRef.focus();
  });

  return (
    <div class="page-shell">
      <div class="page-header">
        <div>
          <div class="eyebrow">DAT browser</div>
          <h1>{title}</h1>
        </div>
        <div class="page-meta">
          {visibleCount()} visible of {rowsResource().length} total
        </div>
      </div>

      <div class="surface-panel">
        <div class="toolbar-row">
          <input
            placeholder={`Filter ${title.toLowerCase()}`}
            ref={inputRef!}
            oninput={(e) => setFilterBy(e.target.value ?? "")}
          />

          <button
            disabled={makingYamlCount() > 0 || !canProcess()}
            onclick={() => makeAllYaml()}
          >
            Export visible DATs
          </button>

          <button
            disabled={makingDatCount() > 0 || !canProcess()}
            onclick={() => makeAllDats()}
          >
            Build visible DATs
          </button>

          <div class="toolbar-spacer"></div>
          <div class="toolbar-stat">{filteredCount()} matching entries</div>
        </div>

        <Show when={!rowsResource.loading} fallback={<div class="loading-state">{`Loading ${title}...`}</div>}>
          <div class="table-shell">
            <table class="table-auto">
              <thead>
                <tr>
                  <For each={columns}>
                    {(col, idx) => (<th
                      class="table-sortable"
                      onclick={() => updateSort(idx())}
                    >
                      {col.name}
                    </th>)}
                  </For>
                  <th class="w-40">Export from DAT</th>
                  <th class="w-40">Generate DAT</th>
                </tr>
              </thead>

              <tbody>
                <For each={rows()}>
                  {(row) => {
                    const descriptor = toDatDescriptor(row);
                    return (
                      <tr>
                        <For each={columns}>
                          {(col) => <td>{col.getter(row)}</td>}
                        </For>

                        <Show
                          when={canProcess()}
                          fallback={
                            <td colSpan={2}>
                              <span class="helper-text">
                                Select a project folder and FFXI folder to enable actions.
                              </span>
                            </td>
                          }
                        >
                          <td>
                            <Switch>
                              <Match when={isProcessing("Yaml", descriptor)}>
                                <span class="helper-text">Exporting...</span>
                              </Match>

                              <Match when={true}>
                                <div class="table-action-group">
                                  <span
                                    class="table-action"
                                    onclick={async () => unwrap(await commands.makeYaml(descriptor, "English"))}
                                  >
                                    EN
                                  </span>
                                  <Show when={hasJp(row)}>
                                    <span
                                      class="table-action"
                                      onclick={async () => unwrap(await commands.makeYaml(descriptor, "Japanese"))}
                                    >
                                      JP
                                    </span>
                                  </Show>
                                </div>
                              </Match>
                            </Switch>
                          </td>
                          <td>
                            <Switch>
                              <Match when={isProcessing("Dat", descriptor)}>
                                <span class="helper-text">Building...</span>
                              </Match>

                              <Match when={true}>
                                <div class="table-action-group">
                                  <Show when={hasWorkingFile(descriptor, "English")}>
                                    <span
                                      class="table-action"
                                      onclick={async () => unwrap(await commands.makeDat(descriptor, "English"))}
                                    >
                                      EN
                                    </span>
                                  </Show>
                                  <Show when={hasJp(row) && hasWorkingFile(descriptor, "Japanese")}>
                                    <span
                                      class="table-action"
                                      onclick={async () => unwrap(await commands.makeDat(descriptor, "Japanese"))}
                                    >
                                      JP
                                    </span>
                                  </Show>
                                </div>
                              </Match>
                            </Switch>
                          </td>
                        </Show>
                      </tr>
                    )
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={filteredCount() > visibleCount()}>
          <div class="helper-text">{`Showing the first ${visibleCount()} results of ${filteredCount()} matches.`}</div>
        </Show>
      </div>
    </div>
  );
}

export default DatTable;
