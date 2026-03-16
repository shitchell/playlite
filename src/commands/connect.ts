import { connectToBrowser, listTabs } from '../browser.js';

export interface ConnectOptions {
  port: string;
}

export async function connect(_portArg: string | undefined, options: ConnectOptions): Promise<void> {
  const port = parseInt(options.port, 10);

  try {
    const { browser, context } = await connectToBrowser(port);
    try {
      const pages = context.pages();
      const count = pages.length;
      const tabWord = count === 1 ? 'tab' : 'tabs';
      console.log(`Connected to browser on port ${port} (${count} ${tabWord})`);
    } finally {
      await browser.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}
