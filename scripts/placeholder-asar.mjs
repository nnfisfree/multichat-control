// Used by release.mjs for the zip that 0.1.x (Electron) installs update from.

/**
 * Tiny but valid asar archive (Electron's format) with one text file in it. It has to be a real
 * archive: Electron treats any file called app.asar as one, and the 0.1.x updater checks for it
 * through Electron's fs patches, which report a plain file with that name as missing.
 */
export function placeholderAsar() {
  const body = Buffer.from('Placeholder that lets version 0.1.x update itself. The app deletes it when it starts.\n')
  const index = Buffer.from(JSON.stringify({ files: { 'README.txt': { size: body.length, offset: '0' } } }))
  const padded = Math.ceil(index.length / 4) * 4
  // Chromium pickle: the index, then a small header with the index size
  const header = Buffer.alloc(8 + padded)
  header.writeUInt32LE(4 + padded, 0)
  header.writeUInt32LE(index.length, 4)
  index.copy(header, 8)
  const size = Buffer.alloc(8)
  size.writeUInt32LE(4, 0)
  size.writeUInt32LE(header.length, 4)
  return Buffer.concat([size, header, body])
}
