export function isStdioTransport(argv: string[]): boolean {
  return argv.includes("--transport") && argv.includes("stdio");
}
