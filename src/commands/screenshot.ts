export interface ScreenshotOptions {
  port: string;
  tab?: string;
  full: boolean;
}

export async function screenshot(path: string | undefined, options: ScreenshotOptions): Promise<void> {
  console.log('not implemented');
}
