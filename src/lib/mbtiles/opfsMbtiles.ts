const DIR = 'handi-mbtiles';

export function mbtilesOpfsRelativePath(key: string): string {
  return `${DIR}/${key}.mbtiles`;
}

export async function copyFileToMbtilesOpfs(file: File, key: string): Promise<string> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(DIR, { create: true });
  const name = `${key}.mbtiles`;
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  try {
    await file.stream().pipeTo(writable);
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
  return mbtilesOpfsRelativePath(key);
}

export async function removeMbtilesOpfsFile(relPath: string): Promise<void> {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length < 2) return;
  const fileName = parts.pop()!;
  const root = await navigator.storage.getDirectory();
  let dir: FileSystemDirectoryHandle = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p);
  }
  await dir.removeEntry(fileName);
}
