// Installed web apps on iOS handle blob downloads poorly, so prefer the share
// sheet ("Save to Files", AirDrop, mail) and fall back to a normal download.
export async function saveTextFile(name: string, text: string, type: string): Promise<void> {
  await saveFile(new File([text], name, { type }));
}

// With `preferDownload` the file goes straight to the downloads folder where
// that works well (everywhere but iOS), which is quicker when saving many files.
export async function saveFile(file: File, preferDownload = false): Promise<void> {
  const name = file.name;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);

  if ((!preferDownload || isIos) && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return; // the user closed the sheet
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
