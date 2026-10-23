import qrcode from "qrcode-generator";

/**
 * Draws text as a QR code (ECC M) with half-block characters, explicitly black on white, so it scans on dark and
 * light terminals alike.
 */
export function terminalQr(text: string): string {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  const quiet = 2;
  const dark = (row: number, col: number) => row >= 0 && col >= 0 && row < size && col < size && code.isDark(row, col);
  const lines: string[] = [];
  for (let row = -quiet; row < size + quiet; row += 2) {
    let line = "\x1b[30;107m";
    for (let col = -quiet; col < size + quiet; col++) {
      const top = dark(row, col);
      const bottom = dark(row + 1, col);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(`${line}\x1b[0m`);
  }
  return `${lines.join("\n")}\n`;
}
