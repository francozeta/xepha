export interface CliWritable {
  write(chunk: string | Uint8Array): boolean;
}

const XEPHA_WORDMARK = String.raw`
██╗  ██╗███████╗██████╗ ██╗  ██╗ █████╗
╚██╗██╔╝██╔════╝██╔══██╗██║  ██║██╔══██╗
 ╚███╔╝ █████╗  ██████╔╝███████║███████║
 ██╔██╗ ██╔══╝  ██╔═══╝ ██╔══██║██╔══██║
██╔╝ ██╗███████╗██║     ██║  ██║██║  ██║
╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝`;

export function writeWordmark(output: CliWritable): void {
  output.write(`${XEPHA_WORDMARK.trim()}\n\n`);
}

export function writeIntro(output: CliWritable, title = "Xepha"): void {
  output.write(`┌ ${title}\n│\n`);
}

export function writeStep(output: CliWritable, message: string): void {
  output.write(`◇  ${message}\n`);
}

export function writeSuccess(output: CliWritable, message: string): void {
  output.write(`◆  ${message}\n`);
}

export function writeOutro(output: CliWritable): void {
  output.write("│\n└\n");
}
