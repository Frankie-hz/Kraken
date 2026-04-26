import { open } from "@tauri-apps/plugin-dialog";
import { Result } from "./bindings";

export async function promptFolder(
  setFolder: (path: string | null) => any,
  defaultPath?: string | null
) {
  const selected = (await open({
    multiple: false,
    directory: true,
    defaultPath: defaultPath ?? undefined,
  })) as string | null;

  if (selected) {
    setFolder(selected);
  }
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.status == "error") {
    throw result.error;
  }
  return result.data;
}

export function projectDisplayPath(path: string | null | undefined, projectRoot: string | null | undefined): string {
  if (!path) {
    return "";
  }
  if (!projectRoot) {
    return path;
  }

  const normalizedPath = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedRoot = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  const rootParts = normalizedRoot.split("/").filter((part) => part.length > 0);
  const projectName = rootParts[rootParts.length - 1] ?? "";

  if (normalizedPath === normalizedRoot) {
    return projectName || path;
  }
  if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    const relativePath = normalizedPath.slice(normalizedRoot.length + 1);
    return [projectName, relativePath].filter(Boolean).join("\\").replaceAll("/", "\\");
  }

  return path;
}
