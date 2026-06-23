export interface storageInterface {
  set(key: string, value: any): Promise<void>;

  get(key: string): Promise<any | undefined>;

  remove(key: string): Promise<void>;

  list(from?: string): Promise<{ [key: string]: any }>;

  // Optional bulk-read fast path. primeReadCache() loads the whole local store
  // once so that subsequent get() calls for local keys are served from memory
  // instead of one IPC per key. Used to decorate large lists (1k+ entries)
  // without thousands of individual storage reads. Must be cleared afterwards.
  primeReadCache?(): Promise<void>;

  clearReadCache?(): void;

  addStyle(css: string): Promise<void>;

  version(): string;

  lang(selector, args?: string[]): string;

  langDirection(): 'ltr' | 'rtl';

  assetUrl(filename: string): string;

  injectCssResource(res: string, head, code?: string | null): void;

  injectjsResource(res: string, head): void;

  addProxyScriptToTag(tag: HTMLScriptElement, name: string): HTMLScriptElement;

  updateDom(head): void;

  storageOnChanged(cb: (changes, namespace) => void): any;
}
