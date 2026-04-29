import { connectToBrowser } from '../browser.js';
import { resolvePort } from '../config.js';

export interface ConnectOptions {
  port: string;
  session?: string;
}

export async function connect(options: ConnectOptions): Promise<void> {
  const port = resolvePort(options);

  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const count = pages.length;
    const tabWord = count === 1 ? 'tab' : 'tabs';
    console.log(`Connected to browser on port ${port} (${count} ${tabWord})`);
  } finally {
    await browser.close();
  }
}
