import { createResource, createSignal, Match, Switch } from "solid-js";
import { checkForUpdate, startUpdate } from "../updating";
import { getVersion } from "@tauri-apps/api/app";

const Updater = () => {
    const [update] = createResource(checkForUpdate);
    const [appVersion] = createResource(getVersion);

    const [getProgress, setProgress] = createSignal<string>("");

    return (
        <div class="updater-shell">
            <Switch>
                <Match when={getProgress()}>
                    <div class="updater-badge">Updating {getProgress()}</div>
                </Match>
                <Match when={!getProgress() && !update.loading && update()}>

                    <div class="updater-badge">Kraken update available ({update()?.version})</div>
                    <div>
                        <button
                            onClick={async () => {
                                await startUpdate(update()!, setProgress);
                            }}
                        >
                            Update
                        </button>
                    </div>
                </Match>
            </Switch>
            <div class="version-tag">v{appVersion()}</div>
        </div>
    );
};

export default Updater;
