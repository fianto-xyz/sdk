/** Where the CLI writes: stdout for results, stderr for usage/errors. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}

export const consoleOutput: Output = {
  out(line) {
    console.log(line);
  },
  err(line) {
    console.error(line);
  },
};
