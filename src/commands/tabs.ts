import { connectToBrowser, listTabs } from '../browser.js';
import { parsePort } from '../config.js';

export interface TabsOptions {
  port: string;
  json: boolean;
}

export async function tabs(options: TabsOptions): Promise<void> {
  const port = parsePort(options.port);
  const { browser, context } = await connectToBrowser(port);

  try {
    const pages = context.pages();
    const tabList = await listTabs(pages);

    if (options.json) {
      console.log(JSON.stringify(tabList, null, 2));
    } else {
      for (const tab of tabList) {
        console.log(`  ${tab.index}: ${tab.title} (${tab.url})`);
      }
    }
  } finally {
    await browser.close();
  }
}
