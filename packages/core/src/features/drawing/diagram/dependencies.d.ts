declare module "@plantuml/core" {
  export function renderToString(
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (error: string) => void,
    options?: { dark?: boolean; maxSvgSize?: number },
  ): void;
}
