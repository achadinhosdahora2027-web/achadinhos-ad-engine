/* Declarações mínimas para compilar sem baixar @types/node (build reprodutível
   no CI e no sandbox). Só o que este módulo usa. */
declare const process: { env: Record<string, string | undefined>; exit(code?: number): never; cwd(): string; };
declare const __dirname: string;
declare module 'fs' {
  export function readFileSync(p: string, enc: string): string;
  export function existsSync(p: string): boolean;
}
declare module 'path' {
  export function join(...parts: string[]): string;
}
