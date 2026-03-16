export interface LaunchOptions {
  port: string;
  profile?: string;
  headless: boolean;
  url?: string;
}

export async function launch(options: LaunchOptions): Promise<void> {
  console.log('not implemented');
}
