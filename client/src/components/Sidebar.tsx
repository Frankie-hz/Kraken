import { For, JSXElement, Show, createEffect, createMemo, createSignal } from "solid-js";
import { HiOutlineDocumentText, HiSolidCube } from "solid-icons/hi";
import { A, useLocation } from "@solidjs/router";
import { useData } from "../store";

export interface NavItemLink {
  name: string;
  path: string;
  icon?: () => JSXElement;
}

export interface NavItemSection {
  header?: string;
  items: NavItemLink[];
}

export interface NavItemGroup {
  group: string;
  sections: NavItemSection[];
  defaultExpanded?: boolean;
}

export type NavItem = NavItemLink | NavItemGroup;
const SIDEBAR_COLLAPSED_STATE_KEY = "kraken_sidebar_collapsed_v1";

function SidebarLinkButton(props: { navItem: NavItemLink; classExt?: string }) {
  return (
    <A
      activeClass="is-active"
      class={"sidebar-nav-button " + (props.classExt ?? "")}
      end={props.navItem.path === "/"}
      href={props.navItem.path}
    >
      {props.navItem.icon?.() ?? <HiSolidCube />}
      {props.navItem.name}
    </A>
  );
}

function SidebarGroup(props: { navItem: NavItemGroup; pathname: string }) {
  const hasActiveItem = createMemo(() =>
    props.navItem.sections.some((section) => section.items.some((item) => item.path === props.pathname))
  );
  const [isExpanded, setIsExpanded] = createSignal(props.navItem.defaultExpanded ?? hasActiveItem());

  createEffect(() => {
    if (hasActiveItem()) {
      setIsExpanded(true);
    }
  });

  return (
    <section class="sidebar-group">
      <button
        aria-expanded={isExpanded()}
        class={"sidebar-group-toggle" + (hasActiveItem() ? " is-active" : "")}
        onclick={() => setIsExpanded((expanded) => !expanded)}
        type="button"
      >
        <span>{props.navItem.group}</span>
        <span class={"sidebar-group-caret" + (isExpanded() ? " is-expanded" : "")} aria-hidden="true">
          <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
          </svg>
        </span>
      </button>

      <div class="sidebar-group-panel" hidden={!isExpanded()}>
        <For each={props.navItem.sections}>
          {(section) => (
            <>
              {section.header ? <div class="sidebar-section">{section.header}</div> : null}
              <div class="sidebar-nav">
                <For each={section.items}>
                  {(item) => <SidebarLinkButton navItem={item} />}
                </For>
              </div>
            </>
          )}
        </For>
      </div>
    </section>
  );
}

function Sidebar(props: { navItems: NavItem[] }) {
  const location = useLocation();
  const {
    processing: { totalProcessingCount },
  } = useData();
  const [isCollapsed, setIsCollapsed] = createSignal(false);

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_STATE_KEY);
      if (raw === "true") {
        setIsCollapsed(true);
      }
    } catch {
      // Ignore persistence failures and use the default expanded state.
    }
  });

  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STATE_KEY, isCollapsed() ? "true" : "false");
    } catch {
      // Ignore persistence failures and keep the UI responsive.
    }
  });

  return (
    <aside class={"sidebar-shell" + (isCollapsed() ? " is-collapsed" : "")}>
      <Show when={!isCollapsed()}>
        <nav class="flex flex-col flex-grow justify-stretch">
          <div class="brand-lockup">
            <div class="brand-lockup__row">
              <div class="brand-title">Kraken</div>
            </div>
          </div>

          <div class="sidebar-nav">
            <For each={props.navItems}>
              {(navItem) =>
                "group" in navItem ? (
                  <SidebarGroup navItem={navItem} pathname={location.pathname} />
                ) : (
                  <SidebarLinkButton navItem={navItem} />
                )
              }
            </For>
          </div>

          <div class="sidebar-footer">
            <hr />
            <SidebarLinkButton navItem={{
              name: "Logs",
              path: "/logs",
              icon: () => <HiOutlineDocumentText />
            }} />

            <div class="processing-pill">
              {totalProcessingCount() == 0 ? (
                "No active processing jobs."
              ) : (
                <div class="flex items-center gap-2">
                  <svg aria-hidden="true" class="inline h-4 w-4 animate-spin fill-slate-200 text-slate-500" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" />
                    <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill" />
                  </svg>
                  {`Processing ${totalProcessingCount()} files.`}
                </div>
              )}
            </div>
          </div>
        </nav>
      </Show>

      <button
        type="button"
        class="sidebar-edge-toggle"
        aria-expanded={!isCollapsed()}
        aria-label={isCollapsed() ? "Expand sidebar" : "Collapse sidebar"}
        title={isCollapsed() ? "Expand sidebar" : "Collapse sidebar"}
        onclick={() => setIsCollapsed((collapsed) => !collapsed)}
      >
        <span class={"sidebar-edge-toggle__arrow" + (isCollapsed() ? " is-collapsed" : "")} aria-hidden="true">
          <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.5 2.5L4.5 6L7.5 9.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
          </svg>
        </span>
      </button>
    </aside>
  );
}

export default Sidebar;
