export interface NavigateOptions {
  port: string;
  tab?: string;
}

export async function navigate(url: string, options: NavigateOptions): Promise<void> {
  console.log('not implemented');
}
