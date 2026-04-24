import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

type DialogKind = "info" | "warning" | "error";
type DialogBaseOptions = {
  title?: string;
  kind?: DialogKind;
  okLabel?: string;
};

type ConfirmOptions = DialogBaseOptions & {
  cancelLabel?: string;
};

type DialogRequest =
  | ({
      mode: "alert";
      message: string;
      resolve: () => void;
    } & DialogBaseOptions)
  | ({
      mode: "confirm";
      message: string;
      resolve: (value: boolean) => void;
    } & ConfirmOptions);

let enqueueDialog:
  | ((request: DialogRequest) => void)
  | null = null;

function fallbackAlert(message: string) {
  window.alert(message);
}

function fallbackConfirm(message: string) {
  return window.confirm(message);
}

export function showMessage(message: string, options: DialogBaseOptions = {}) {
  return new Promise<void>((resolve) => {
    if (!enqueueDialog) {
      fallbackAlert(message);
      resolve();
      return;
    }

    enqueueDialog({
      mode: "alert",
      message,
      resolve,
      ...options,
    });
  });
}

export function showConfirm(message: string, options: ConfirmOptions = {}) {
  return new Promise<boolean>((resolve) => {
    if (!enqueueDialog) {
      resolve(fallbackConfirm(message));
      return;
    }

    enqueueDialog({
      mode: "confirm",
      message,
      resolve,
      ...options,
    });
  });
}

function dialogToneClass(kind: DialogKind) {
  switch (kind) {
    case "warning":
      return "app-dialog__icon is-warning";
    case "error":
      return "app-dialog__icon is-error";
    default:
      return "app-dialog__icon is-info";
  }
}

export function AppDialogHost() {
  const [queue, setQueue] = createSignal<DialogRequest[]>([]);

  enqueueDialog = (request) => {
    setQueue((current) => [...current, request]);
  };

  onCleanup(() => {
    enqueueDialog = null;
  });

  const currentDialog = createMemo(() => queue()[0] ?? null);

  const dismissCurrent = (confirmed: boolean) => {
    const current = currentDialog();
    if (!current) {
      return;
    }

    if (current.mode === "confirm") {
      current.resolve(confirmed);
    } else {
      current.resolve();
    }

    setQueue((currentQueue) => currentQueue.slice(1));
  };

  createEffect(() => {
    const dialog = currentDialog();
    if (!dialog) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      dismissCurrent(false);
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <Show when={currentDialog()}>
      {(dialog) => (
        <div class="app-dialog-backdrop" onClick={() => dismissCurrent(false)}>
          <div
            class="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="app-dialog__header">
              <div class={dialogToneClass(dialog().kind ?? "info")} aria-hidden="true" />
              <div class="app-dialog__heading">
                <div id="app-dialog-title" class="app-dialog__title">
                  {dialog().title ?? (dialog().mode === "confirm" ? "Confirm Action" : "Notice")}
                </div>
              </div>
            </div>

            <div class="app-dialog__body">{dialog().message}</div>

            <div class="app-dialog__actions">
              <Show when={dialog().mode === "confirm"}>
                <button class="app-dialog__button is-secondary" onClick={() => dismissCurrent(false)}>
                  {dialog().cancelLabel ?? "Cancel"}
                </button>
              </Show>
              <button class="app-dialog__button" onClick={() => dismissCurrent(true)}>
                {dialog().okLabel ?? "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
