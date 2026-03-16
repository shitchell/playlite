export interface EvalOptions {
  port: string;
  tab?: string;
  lib?: string[];
  json: boolean;
}

export async function evalCommand(code: string, options: EvalOptions): Promise<void> {
  console.log('not implemented');
}
