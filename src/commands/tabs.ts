import { connectToBrowser, listTabs } from '../browser.js';

export interface TabsOptions {
  port: string;
  json: boolean;
}

export async function tabs(options: TabsOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  if (isNaN(port)) {
    console.error(`Invalid port: "${options.port}"`);
    process.exit(1);
  }
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
