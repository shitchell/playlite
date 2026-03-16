export interface RunOptions {
  port: string;
  tab?: string;
  lib?: string[];
}

export async function run(script: string, options: RunOptions): Promise<void> {
  console.log('not implemented');
}
