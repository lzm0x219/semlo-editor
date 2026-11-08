/** Local picker contract; it does not describe or call the Yuque service API. */
export interface ContentChoice {
  id: string;
  title: string;
  href: string;
  kind: "document" | "table";
  description?: string;
}

export interface ContentEmbedTarget {
  url: string;
  /** 仅当宿主信任阅读页及其跳转目标时，允许页面使用自身源的存储和身份。 */
  allowSameOrigin?: boolean;
}

/** The integrating application owns access, search, and link interpretation. */
export interface ContentPickerProvider {
  search(query: string, signal: AbortSignal): Promise<readonly ContentChoice[]>;
  resolveLink(link: string, signal: AbortSignal): Promise<ContentChoice | null>;
  /** 返回可嵌入的阅读页地址或配置；实际权限由宿主负责，返回值不保存到文档。 */
  resolveEmbed?(choice: ContentChoice): string | ContentEmbedTarget | null | undefined;
}

export type PickerResult<T> =
  | { status: "ready"; value: T }
  | { status: "superseded" }
  | { status: "failed"; error: unknown };

/** One instance per open picker. Search and link resolution supersede each other. */
export class ContentPickerController {
  private revision = 0;
  private active: AbortController | undefined;
  private disposed = false;

  constructor(private readonly provider: ContentPickerProvider) {}

  private async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<PickerResult<T>> {
    if (this.disposed) return { status: "superseded" };
    const revision = ++this.revision;
    const previous = this.active;
    const active = new AbortController();
    this.active = active;
    previous?.abort();
    if (this.disposed || revision !== this.revision || active.signal.aborted) return { status: "superseded" };
    try {
      const value = await operation(active.signal);
      if (this.disposed || revision !== this.revision || active.signal.aborted) return { status: "superseded" };
      return { status: "ready", value };
    } catch (error) {
      if (this.disposed || revision !== this.revision || active.signal.aborted) return { status: "superseded" };
      return { status: "failed", error };
    } finally {
      if (this.active === active) this.active = undefined;
    }
  }

  search(query: string): Promise<PickerResult<readonly ContentChoice[]>> {
    return this.run((signal) => this.provider.search(query, signal));
  }

  resolveLink(link: string): Promise<PickerResult<ContentChoice | null>> {
    return this.run((signal) => this.provider.resolveLink(link, signal));
  }

  cancel() {
    if (this.disposed) return;
    this.revision++;
    const previous = this.active;
    this.active = undefined;
    previous?.abort();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    const previous = this.active;
    this.active = undefined;
    previous?.abort();
  }
}
